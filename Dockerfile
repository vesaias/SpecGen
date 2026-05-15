# syntax=docker/dockerfile:1.7
#
# Production image for SpecGen. Single-container, all-in-one:
#   - Express API (packages/server) listens on 6101
#   - Same Express app serves the built webapp statics
#   - SQLite database at /data/specgen.db (mount /data as a volume)
#   - Project source codebases at /workspaces (mount as bind volume)
#
# Build:  docker build -t specgen:latest .
# Run:    docker run -p 6101:6101 -v specgen-data:/data -v /local/code:/workspaces specgen:latest
#
# The build is multi-stage:
#   1. deps     — install pnpm + workspace deps (cached layer when lockfile unchanged)
#   2. builder  — copy src + build all packages + pnpm deploy the server
#   3. runner   — minimal Node image with only the deployed server + webapp statics
#
# ----------------------------------------------------------------------------
# Stage 1: deps — install pnpm + workspace deps, cached on lockfile only
# ----------------------------------------------------------------------------
# Pinned to 22.20.0 because newer 22.x patches ship a V8 Turbofan codegen bug
# that crashes tsup `--dts` builds inside Docker with SIGTRAP
# ("RepresentationChangerError: ... cannot be changed to ..."). 22.20.0 has
# node:sqlite (server depends on it) and a stable Turbofan for this build.
FROM node:22.20.0-bookworm-slim AS deps
WORKDIR /repo
ENV PNPM_HOME=/pnpm CI=true
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

# Copy workspace + lock first for max layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
# Each package needs its own package.json present before `pnpm install` so the
# workspace links resolve correctly
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/server/package.json packages/server/
COPY packages/webapp/package.json packages/webapp/
COPY packages/parser-dotnet/package.json packages/parser-dotnet/
COPY packages/parser-react/package.json packages/parser-react/
COPY packages/parser-python/package.json packages/parser-python/
COPY packages/connector-git-docs/package.json packages/connector-git-docs/
COPY packages/connector-confluence/package.json packages/connector-confluence/
COPY packages/parser-frontend-capture/package.json packages/parser-frontend-capture/
COPY packages/parser-llm/package.json packages/parser-llm/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ----------------------------------------------------------------------------
# Stage 2: builder — build all packages + deploy server for prod runtime
# ----------------------------------------------------------------------------
FROM deps AS builder
WORKDIR /repo

# Now copy the actual sources
COPY tsconfig.base.json biome.json ./
COPY packages packages

# Build core + parsers + server + webapp + cli (CLI not used in container but
# its build is fast and keeps the monorepo happy)
RUN pnpm -r --filter './packages/*' build

# `pnpm deploy` produces a self-contained directory with the server and all
# of its production dependencies, including workspace deps flattened into
# node_modules/@specgen/{core,parser-*}.
RUN pnpm --filter @specgen/server deploy --prod /deploy/server

# ----------------------------------------------------------------------------
# Stage 3: runner — minimal image, only what's needed at runtime
# ----------------------------------------------------------------------------
FROM node:22.20.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# git for future GitHub-connector clone-to-cache flows (Phase D).
# ca-certificates for HTTPS calls (Anthropic / OpenAI / Confluence APIs).
# Chromium runtime libs for headless PDF export via puppeteer-core +
# chrome-headless-shell (Phase D fast-follow v0.2 — Task F.0). Adds ~200MB.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates git wget \
        fonts-liberation libnss3 libatk1.0-0 libatk-bridge2.0-0 \
        libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
        libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 \
        libasound2 libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

# Install chrome-headless-shell into /opt/chrome via @puppeteer/browsers, then
# symlink the resolved binary to a stable path so CHROME_HEADLESS_SHELL_PATH
# does not need to embed the (version-specific) install layout.
RUN npx --yes @puppeteer/browsers install chrome-headless-shell@stable --path /opt/chrome \
    && CHROME_BIN=$(find /opt/chrome -type f -name chrome-headless-shell | head -1) \
    && test -n "$CHROME_BIN" \
    && ln -s "$CHROME_BIN" /usr/local/bin/chrome-headless-shell \
    && chown -R node:node /opt/chrome

# Install the Claude Code CLI so the `claude_code` AI provider works in-container.
# At runtime set CLAUDE_CODE_OAUTH_TOKEN (subscription) — do NOT set ANTHROPIC_API_KEY
# at the same time, as the client strips it before spawn to keep subscription billing.
RUN npm install -g @anthropic-ai/claude-code

# Server (with deployed prod node_modules + dist)
COPY --from=builder /deploy/server /app/server

# Webapp statics — served by the same Express process via SPECGEN_WEBAPP_DIST
COPY --from=builder /repo/packages/webapp/dist /app/webapp

# Packaged profiles ship alongside the server. SPECGEN_PROFILES_DIR points
# Express at this location, decoupling us from any "../../core/profiles"
# relative path guesswork.
COPY --from=builder /repo/packages/core/profiles /app/profiles

# Data lives on a mounted volume so the SQLite DB + run-logs survive `docker rm`.
# /workspaces is the canonical place to mount project source codebases.
RUN mkdir -p /data /workspaces && chown -R node:node /data /workspaces /app

ENV SPECGEN_BIND_HOST=0.0.0.0 \
    SPECGEN_BIND_PORT=6101 \
    SPECGEN_DB=/data/specgen.db \
    SPECGEN_WEBAPP_DIST=/app/webapp \
    SPECGEN_PROFILES_DIR=/app/profiles \
    SPECGEN_ALLOW_PUBLIC=1 \
    CHROME_HEADLESS_SHELL_PATH=/usr/local/bin/chrome-headless-shell

VOLUME ["/data", "/workspaces"]
EXPOSE 6101

# Healthcheck hits the projects-list endpoint; returns 200 with [] when the
# DB is empty, which is a good signal the migrations ran + Express is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --spider http://127.0.0.1:6101/api/projects || exit 1

USER node
CMD ["node", "/app/server/dist/serve.js"]
