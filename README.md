# SpecGen

Profile-based AI documentation. Point it at a codebase, pick a profile, and get a structured, editable webapp pre-populated with endpoint docs, page specs, domain events, and handler descriptions. Optional Playwright capture enriches frontend pages with real screenshots, observed DOM, and observed network traffic so the AI describes pages from what actually rendered, not just from source.

## How It Works

```
┌────────────────────────────────────────────────────────────────────┐
│                              PARSE                                 │
│                                                                    │
│   .NET (C#) ──── controllers, DTOs, FluentValidation, events       │
│   React/TS ───── pages, hooks, routes                              │
│   Python ─────── FastAPI / Flask / Django routes                   │
│   LLM ────────── universal fallback when no rule parser claims it  │
│                                                                    │
└────────────────────────────────┬───────────────────────────────────┘
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│                            AI ENRICH                               │
│                                                                    │
│   Per-profile prompts ── pm-spec (business) or dev-api-reference   │
│   Drift detection ────── source-hash + capture-hash gates          │
│   Smart-tree ─────────── AI reorganizes the sidebar by feature     │
│                                                                    │
└────────────────────────────────┬───────────────────────────────────┘
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│                             CAPTURE                                │
│                                                                    │
│   Playwright ─── real browser per page, screenshot + observed DOM  │
│   Auth ───────── form / cookie / header / basic / localStorage     │
│   Auto-chain ── observations feed back into AI re-enrichment       │
│                                                                    │
└────────────────────────────────┬───────────────────────────────────┘
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│                              EDIT                                  │
│                                                                    │
│   Tiptap editor ─ rich-text blocks, tables, code, callouts         │
│   Versioning ─── per-item version history                          │
│   Drag-tree ──── reorder the sidebar, persist your structure       │
│                                                                    │
└────────────────────────────────┬───────────────────────────────────┘
                                 ▼
┌────────────────────────────────────────────────────────────────────┐
│                              PUSH                                  │
│                                                                    │
│   Markdown ───── per-item .md or whole-project .zip                │
│   Git /docs ──── commit to a target repo's docs branch             │
│   Confluence ─── render to ADF, preserve the sidebar tree          │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

> SpecGen runs **unauthenticated on localhost**. Don't expose it to a LAN or the internet — see [SECURITY.md](SECURITY.md).

## Features

| Feature | Description |
|---------|-------------|
| **Multi-Parser** | .NET, React/TS, Python, plus an LLM fallback parser that handles any language by per-file AI extraction |
| **Profile System** | Switch documentation voice per project — `pm-spec` (business-readable) or `dev-api-reference` (type-precise developer reference) |
| **Live Playwright Capture** | Real browser per page, real screenshots, observed DOM sections (tables, forms, buttons), observed XHR/fetch traffic. AI rewrites the page narrative from what actually rendered |
| **Drift-Aware AI** | `sourceHash` + `captureHash` gates — AI only re-runs on items whose inputs have actually changed. Manual override via Rebuild / per-item Re-enrich |
| **Smart Tree** | AI groups items by feature/domain. A post-pass splits into Backend / Frontend / Events & Handlers top-level folders |
| **Tiptap Editor** | Block-based rich text, tables, code, callouts. Saved blocks survive AI re-runs (unless you force a Rebuild) |
| **Connectors** | Encrypted token store (AES-256-GCM). GitHub PATs for source + git-docs push; Confluence API tokens for ADF push; capture auth (form/cookie/header/basic/localStorage) |
| **GitHub Source** | Parse a remote repo directly via the API. SHA-keyed blob cache makes re-parses nearly free |
| **Auto-poll GitHub** | Opt-in per project. Server checks the upstream branch every 24h and auto-runs an Update when the SHA has moved; if auto-push is also on, your docs branch refreshes without a click |
| **Run Worker + SSE** | All long-running work goes through a queue with live event streams to the UI |

## Quick Start

```bash
git clone https://github.com/vesaias/specgen.git
cd specgen
cp .env.example .env
# Edit .env if needed — API keys can also be set from Settings > AI

docker compose up -d --build
```

Open `http://localhost:6101`. Then:

1. **+ New project** — point at a local directory or a GitHub repo.
2. **Update** — parses + AI-enriches. (Or **Re-parse (no AI)** for a dry parse.)
3. **Capture** (optional, frontend only) — configure the base URL + auth in Settings > Capture, then click Capture.
4. Edit items in the editor. Push to git `/docs` or Confluence from Settings > Connectors.

Or `pnpm dev` directly for local development (API on `:6101`, webapp on `:6100` with HMR).

## Profiles

| Profile | Voice |
|---------|-------|
| `pm-spec` (default) | Business-readable specs for PMs and BAs. Detailed orchestration steps, named DB tables and columns, inline error cases |
| `dev-api-reference` | Type-precise developer reference. Tighter, source-first, code-aware |

Switch per-project in Settings > AI. Fork a profile in `packages/core/profiles/<id>/` to override individual prompts.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node 22+, Express, `node:sqlite`, p-queue, Zod |
| Frontend | React 18, Tailwind CSS, Vite, Tiptap, dnd-kit |
| AI | Anthropic SDK, OpenAI SDK, Claude Code CLI, local stub |
| Capture | Playwright (chrome-headless-shell) |
| Connectors | Octokit (GitHub), Confluence REST + ADF |
| Infrastructure | Docker Compose, pnpm workspace |

## Repository Layout

```
packages/
├── core/                       # spec types, profile + generator + parser registries
├── cli/                        # specgen init | parse | serve
├── server/                     # Express API
├── webapp/                     # React UI
├── parser-{dotnet,react,python,llm}/
├── parser-frontend-capture/    # Playwright capture
└── connector-{git-docs,confluence}/
```

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Easy wins: a new language parser, a new profile voice, a new push connector.

## Security

Found a vulnerability? See [SECURITY.md](SECURITY.md). Please don't open public issues for security bugs.

## Privacy

**SpecGen is self-hosted — NOT a hosted service.** Your source code, generated specs, and connector tokens stay on your machine. Data is sent only to the AI provider you configure. I don't collect, store, or have access to any of your data.

## License

[MIT](LICENSE)
