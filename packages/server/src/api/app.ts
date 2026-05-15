import type { GeneratorRegistry, ParserRegistry } from "@specgen/core";
import express from "express";
import { errorHandler } from "../middleware/errorHandler.js";
import { requireSameOrigin } from "../middleware/requireSameOrigin.js";
import type { ConfluencePageMapRepository } from "../repositories/ConfluencePageMapRepository.js";
import type { GitDocsStateRepository } from "../repositories/GitDocsStateRepository.js";
import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import type { SqliteRunRepository } from "../repositories/SqliteRunRepository.js";
import type { PdfService } from "../services/PdfService.js";
import type { RunEventBroker } from "../services/RunEventBroker.js";
import type { RunWorker } from "../services/RunWorker.js";
import type { TokenStore } from "../services/TokenStore.js";
import { aiProvidersRouter, projectAiRouter } from "./ai.js";
import { capturesRouter } from "./captures.js";
import { confluenceRouter } from "./confluence.js";
import { exportsRouter } from "./exports.js";
import { gitDocsRouter } from "./gitDocs.js";
import { itemsRouter } from "./items.js";
import { probeRouter } from "./probe.js";
import { profilesRouter, projectProfilesRouter } from "./profiles.js";
import { projectsRouter } from "./projects.js";
import { projectRunsRouter, runsRouter } from "./runs.js";
import { specRouter } from "./spec.js";
import { tokensRouter } from "./tokens.js";

export interface AppDeps {
  projects: SqliteProjectRepository;
  /** Absolute path to the packaged profiles directory (e.g. packages/core/profiles). */
  packagedProfilesDir: string;
  runs?: SqliteRunRepository;
  worker?: RunWorker;
  broker?: RunEventBroker;
  /** Encrypted token store for connector credentials (Phase D). */
  tokens?: TokenStore;
  /** Git /docs push state (Phase D — Task D.6). Requires `tokens` to be useful. */
  gitDocsState?: GitDocsStateRepository;
  /**
   * Confluence page-map state (Phase D fast-follow v0.2, Task F.6). Required to
   * mount the Confluence push routes; without it the connector routes 404.
   */
  confluencePageMap?: ConfluencePageMapRepository;
  /**
   * PDF export service (Phase D fast-follow v0.2, Task F.1). Optional — when
   * `CHROME_HEADLESS_SHELL_PATH` is unset (e.g. dev hosts without Chromium)
   * the PDF routes return HTTP 503.
   */
  pdf?: PdfService;
  /**
   * Parser registry — required to mount the probe endpoint
   * (`POST /api/v0/projects/probe`). Optional so that minimal test apps that
   * don't exercise probe can omit it.
   */
  parsers?: ParserRegistry;
  /**
   * Generator registry — when wired in, the runs API includes the
   * generator's display `name` on each row so the webapp can render a
   * friendly label instead of the raw `generator_id`. Optional for
   * minimal test apps; the field is simply omitted when absent.
   */
  generators?: GeneratorRegistry;
}

export function buildApp(deps: AppDeps): express.Express {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  // text/plain body parser for PATCH profile file override endpoint (prompts can be ~10KB max)
  app.use(express.text({ type: "text/plain", limit: "1mb" }));
  // Global CSRF/same-origin guard — protects all state-changing routes (PUT/POST/PATCH/DELETE).
  app.use(requireSameOrigin);
  app.use("/api/projects", projectsRouter(deps.projects));
  // Spec routes — note: Express needs mergeParams for :slug to be visible in the sub-router
  app.use("/api/projects/:slug/spec", specRouter(deps.projects));
  // AI providers (server-wide) and per-project AI test endpoint
  app.use("/api/ai", aiProvidersRouter());
  app.use(
    "/api/projects",
    projectAiRouter({ projects: deps.projects, packagedProfilesDir: deps.packagedProfilesDir }),
  );
  // Profile listing + file read (server-wide) and per-project profile override CRUD
  app.use(
    "/api/profiles",
    profilesRouter({ projects: deps.projects, packagedProfilesDir: deps.packagedProfilesDir }),
  );
  app.use(
    "/api/projects",
    projectProfilesRouter({
      projects: deps.projects,
      packagedProfilesDir: deps.packagedProfilesDir,
    }),
  );
  // Run endpoints (C.6+) — only mounted when the worker is wired in
  if (deps.runs && deps.worker && deps.broker) {
    app.use(
      "/api/projects",
      projectRunsRouter({
        projects: deps.projects,
        runs: deps.runs,
        worker: deps.worker,
        broker: deps.broker,
        generators: deps.generators,
      }),
    );
    app.use(
      "/api/runs",
      runsRouter({
        runs: deps.runs,
        broker: deps.broker,
        worker: deps.worker,
        generators: deps.generators,
      }),
    );
    // Single-item re-enrich (Task 8 of the AI enrichment pipeline). Mounted
    // under /api/v0/ — depends on the worker being wired in to enqueue runs.
    app.use("/api/v0/projects", itemsRouter({ projects: deps.projects, worker: deps.worker }));
  }
  // Onboarding probe — POST /api/v0/projects/probe. Registered before the
  // slug-parameterised routes so Express doesn't try to match "probe" as a slug.
  // gated on parsers being provided so minimal test apps can omit it.
  if (deps.parsers) {
    app.use("/api/v0/projects", probeRouter({ parsers: deps.parsers }));
  }
  // Phase D — Markdown export endpoints. Always available.
  // Phase D fast-follow v0.2 — same router gains PDF endpoints, gated at the
  // route level on `deps.pdf` (returns 503 when Chromium is not installed).
  app.use("/api/v0/projects", exportsRouter({ projects: deps.projects, pdf: deps.pdf }));
  // Phase D — connector token store. Mounted under /api/v0/ per PD3.
  if (deps.tokens) {
    app.use("/api/v0/projects", tokensRouter({ projects: deps.projects, tokens: deps.tokens }));
  }
  // Phase D — Git /docs push connector (Task D.6). Needs both tokens (for the
  // PAT) and a state repo (to persist last-push SHAs).
  if (deps.tokens && deps.gitDocsState) {
    app.use(
      "/api/v0/projects",
      gitDocsRouter({
        projects: deps.projects,
        gitDocsState: deps.gitDocsState,
        tokens: deps.tokens,
      }),
    );
  }
  // Frontend page capture (Playwright). Mounted under /api/v0/. Requires the
  // worker (to enqueue capture runs) and the token store (to resolve
  // capture-auth credentials at run time). Without these, the captures
  // endpoint silently goes unmounted; the webapp's Capture settings tab still
  // renders but the "Capture screenshots" button will 404.
  if (deps.worker && deps.tokens) {
    app.use(
      "/api/v0/projects",
      capturesRouter({ projects: deps.projects, tokens: deps.tokens, worker: deps.worker }),
    );
  }
  // Phase D fast-follow v0.2 — Confluence push connector (Task F.8). Needs
  // tokens (for email + apiToken), the page-map repo (to track item↔page),
  // and the run worker (push is now an enqueued streaming run, not sync).
  if (deps.tokens && deps.confluencePageMap && deps.worker) {
    app.use(
      "/api/v0/projects",
      confluenceRouter({
        projects: deps.projects,
        confluencePageMap: deps.confluencePageMap,
        tokens: deps.tokens,
        worker: deps.worker,
      }),
    );
  }
  // Error handler must be registered AFTER all routes
  app.use(errorHandler);
  return app;
}
