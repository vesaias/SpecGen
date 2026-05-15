/**
 * Production + dev HTTP entry point for the SpecGen API server.
 *
 *   Dev:        pnpm --filter @specgen/server dev   (tsx watches src/serve.ts)
 *   Container:  node dist/serve.js                  (built by tsup)
 *
 * Environment overrides:
 *   SPECGEN_BIND_HOST       bind host (default 127.0.0.1; non-loopback needs SPECGEN_ALLOW_PUBLIC=1)
 *   SPECGEN_BIND_PORT       bind port (default 6101)
 *   SPECGEN_DB              sqlite path (default ~/.specgen/specgen.db)
 *   SPECGEN_PROFILES_DIR    path to the packaged-profiles directory
 *   SPECGEN_WEBAPP_DIST     when set, serve the built webapp statics + SPA fallback
 *   SPECGEN_ALLOW_PUBLIC=1  opt-in to bind non-loopback (no auth yet — own the risk)
 */
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GeneratorRegistry,
  ParserRegistry,
  confluencePushGenerator,
  enrichItemsGenerator,
  enrichmentPipelineGenerator,
  frontendCaptureGenerator,
  fullTreeSpecGenerator,
  projectBootstrapGenerator,
  smartTreeGenerator,
  subdirAwarePlugin,
} from "@specgen/core";
import { dotnetParser } from "@specgen/parser-dotnet";
import { llmParser } from "@specgen/parser-llm";
import { pythonParser } from "@specgen/parser-python";
import { reactParser } from "@specgen/parser-react";
import express from "express";
import { buildApp } from "./api/app.js";
import { migrate } from "./db/migrate.js";
import { openDb } from "./db/sqlite.js";
import { ConfluencePageMapRepository } from "./repositories/ConfluencePageMapRepository.js";
import { GitDocsStateRepository } from "./repositories/GitDocsStateRepository.js";
import { SqliteProjectRepository } from "./repositories/SqliteProjectRepository.js";
import { SqliteRunRepository } from "./repositories/SqliteRunRepository.js";
import { resolveMasterKey } from "./services/MasterKey.js";
import { PdfService } from "./services/PdfService.js";
import { RunEventBroker } from "./services/RunEventBroker.js";
import { RunWorker } from "./services/RunWorker.js";
import { TokenStore } from "./services/TokenStore.js";
import { installAutoEnrichAfterCapture } from "./services/autoEnrichAfterCapture.js";
import { installAutoEnrichOnInitialParse } from "./services/autoEnrichOnInitialParse.js";
import { installAutoPushOnRunComplete } from "./services/autoPushOnRunComplete.js";
import { installGithubCommitPoller } from "./services/githubCommitPoller.js";
import { installMarkProjectParsed } from "./services/markProjectParsed.js";

const host = process.env.SPECGEN_BIND_HOST ?? "127.0.0.1";
const port = process.env.SPECGEN_BIND_PORT ? Number(process.env.SPECGEN_BIND_PORT) : 6101;

// Refuse to bind a non-loopback host without explicit opt-in. SpecGen is
// unauthenticated by default; until the password gate ships there is no way
// to safely expose it to a LAN, let alone the internet.
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);
if (!LOOPBACK.has(host) && process.env.SPECGEN_ALLOW_PUBLIC !== "1") {
  process.stderr.write(
    `[specgen] refusing to bind SPECGEN_BIND_HOST=${host} — non-loopback hosts require SPECGEN_ALLOW_PUBLIC=1 (the server has no auth yet; see SECURITY.md).\n`,
  );
  process.exit(1);
}

const defaultDb = path.join(homedir(), ".specgen", "specgen.db");
const dbPath = path.resolve(process.env.SPECGEN_DB ?? defaultDb);

mkdirSync(path.dirname(dbPath), { recursive: true });

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "db", "migrations");

const db = openDb(dbPath);
migrate(db, migrationsDir);

// Phase D — resolve the master key (env override, on-disk default, or generate)
// and stand up the encrypted token store. Master key + sqlite db live in the
// same data directory so a single backup covers both.
const masterKey = resolveMasterKey(path.dirname(dbPath));
const tokens = new TokenStore(db, masterKey);

// Phase D (D.6) — state row tracking the last successful git-docs push per project.
const gitDocsState = new GitDocsStateRepository(db);

// Phase D fast-follow v0.2 (F.6) — item↔Confluence-page mapping table. One row
// per (project, item) pair; rows survive across pushes so we can update the
// same Confluence page without title-based lookup.
const confluencePageMap = new ConfluencePageMapRepository(db);

// Packaged profiles live in packages/core/profiles (dev) or next to the server
// dist (built). Container builds set SPECGEN_PROFILES_DIR explicitly because the
// post-deploy layout doesn't match either default.
const packagedProfilesDir =
  process.env.SPECGEN_PROFILES_DIR ?? path.resolve(here, "..", "..", "core", "profiles");

const projects = new SqliteProjectRepository(db);
const runs = new SqliteRunRepository(db);

// Run-log files stored alongside the DB
const logsDir = path.join(path.dirname(dbPath), "run-logs");
const broker = new RunEventBroker(logsDir);

// Mark any runs that were in-flight during a previous crashed process as interrupted
const interruptedCount = runs.markInterruptedOnBoot();
if (interruptedCount > 0) {
  process.stdout.write(
    `[specgen] marked ${interruptedCount} run(s) as interrupted from previous boot\n`,
  );
}

const parserRegistry = new ParserRegistry();
parserRegistry.register(subdirAwarePlugin(dotnetParser));
parserRegistry.register(subdirAwarePlugin(pythonParser));
parserRegistry.register(subdirAwarePlugin(reactParser));
parserRegistry.register(subdirAwarePlugin(llmParser));

const generatorRegistry = new GeneratorRegistry();
generatorRegistry.register(fullTreeSpecGenerator);
generatorRegistry.register(projectBootstrapGenerator);
generatorRegistry.register(smartTreeGenerator);
generatorRegistry.register(enrichmentPipelineGenerator);
generatorRegistry.register(enrichItemsGenerator);
generatorRegistry.register(frontendCaptureGenerator);
generatorRegistry.register(confluencePushGenerator);

const worker = new RunWorker({
  projects,
  runs,
  broker,
  packagedProfilesDir,
  parserRegistry,
  generatorRegistry,
  tokens,
});

// Auto-trigger: after a successful initial full-tree-spec parse (no prior
// successful full-tree-spec run for the project, itemsCreated > 0, AI
// provider configured), chain in the enrichment-pipeline in 'initial' mode
// so the user gets bootstrap + per-item enrichment + smart-tree without
// having to click again. See services/autoEnrichOnInitialParse.ts.
installAutoEnrichOnInitialParse({ worker, projects, runs });

// Auto-trigger: after a successful frontend-capture run, enqueue an
// enrichment-pipeline in change-detect mode scoped to the items the capture
// actually touched. The capture sets captureHash on each item; full-tree-spec's
// shouldEnrich now treats captureHash drift as a re-enrichment signal, so the
// scoped run only burns tokens on pages whose observations are new to AI.
installAutoEnrichAfterCapture({ worker, projects });

// Stamp `projects.last_parsed_at` after every successful parse / pipeline run
// so the dashboard's "parsed X / never parsed" hint reflects reality. Also
// performs a one-time backfill from the runs table for projects that had
// prior successful runs before this listener existed.
installMarkProjectParsed({ worker, projects, db });

// Auto-push: after a successful enrichment-pipeline or full-tree-spec run,
// fire any push connectors the project has opted into via
// `connectors.gitDocs.autoPush` / `connectors.confluence.autoPush`. Chained
// pushes never re-trigger themselves — the generator-id filter excludes the
// push generators themselves. See services/autoPushOnRunComplete.ts.
installAutoPushOnRunComplete({
  worker,
  projects,
  gitDocsState,
  confluencePageMap,
  tokens,
});

// GitHub commit poller — every 24h (or SPECGEN_GITHUB_POLL_INTERVAL_SEC), check
// each GitHub-source project that has opted into auto-poll. When the upstream
// branch has moved, enqueue an enrichment-pipeline run (which auto-push will
// then chain through to a docs push if that's also opted in).
installGithubCommitPoller({ worker, projects, tokens });

// Phase D fast-follow v0.2 — PDF export via Puppeteer. Only stand up the
// service when Chromium is reachable; otherwise the route layer will 503 on
// requests, which is the right behaviour for dev hosts without `chrome-
// headless-shell` installed.
const pdf = process.env.CHROME_HEADLESS_SHELL_PATH ? new PdfService() : undefined;

const app = buildApp({
  projects,
  runs,
  worker,
  broker,
  packagedProfilesDir,
  parsers: parserRegistry,
  generators: generatorRegistry,
  tokens,
  gitDocsState,
  confluencePageMap,
  pdf,
});

// In production we serve the built webapp statics from the same Express app.
// SPECGEN_WEBAPP_DIST points at packages/webapp/dist (or its container copy).
// When unset, the dev workflow (Vite on :6100) handles statics instead.
const webappDist = process.env.SPECGEN_WEBAPP_DIST;
if (webappDist && existsSync(webappDist)) {
  app.use(express.static(webappDist));
  // SPA fallback for any unmatched GET that isn't an /api/* route.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(webappDist, "index.html"));
  });
}

app.listen(port, host, () => {
  process.stdout.write(`[specgen] listening on http://${host}:${port}\n`);
  if (webappDist && existsSync(webappDist)) {
    process.stdout.write(`[specgen] serving webapp from ${webappDist}\n`);
  } else {
    process.stdout.write("[specgen] dev mode — webapp served by Vite on :6100\n");
  }
});
