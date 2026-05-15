/**
 * autoPushOnRunComplete — chain configured pushes after enrichment runs.
 *
 * Mirrors `installAutoEnrichOnInitialParse`'s shape: subscribe to
 * `worker.onRunCompleted`, react when the completed run is a successful
 * enrichment-pipeline or full-tree-spec run, and trigger any push connectors
 * the project has opted into via `connectors.*.autoPush === true`.
 *
 * Eligible triggers:
 *   - generatorId === "enrichment-pipeline" (Rebuild + initial auto-pipeline)
 *   - generatorId === "full-tree-spec"      (Update — also changes items)
 *
 * Explicitly skipped:
 *   - "confluence-push" / git-docs pushes — would create an infinite chain.
 *   - "frontend-capture" — captures don't change items in a way that needs
 *     a doc push (only adds screenshots).
 *   - Any other generator id — bootstrap / capture / smart-tree-only etc.
 *
 * Auto-push runs are best-effort:
 *   - Missing config or missing token? Silently skip — the user simply hasn't
 *     completed setup yet. We log at info-level so the operator can grep for
 *     "[auto-push]" in stderr.
 *   - Connector throws? Catch + log; don't mask the enrichment run's success.
 *
 * The two pushes (git-docs + Confluence) are kicked off in parallel — they
 * target independent backends and there's no ordering requirement. The
 * Confluence push goes through the RunWorker (so it streams via SSE);
 * git-docs runs directly through `runGitDocsPush` since the existing route
 * is synchronous (no streaming generator yet).
 */

import { ConfluenceClient, ConfluencePushService } from "@specgen/connector-confluence";
import type { ConfluencePageMapRepository } from "../repositories/ConfluencePageMapRepository.js";
import type { GitDocsStateRepository } from "../repositories/GitDocsStateRepository.js";
import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import type { Project } from "../types/Project.js";
import type { RunCompletedEvent, RunWorker } from "./RunWorker.js";
import type { TokenStore } from "./TokenStore.js";
import { runGitDocsPush } from "./gitDocsPush.js";

export interface AutoPushDeps {
  worker: RunWorker;
  projects: SqliteProjectRepository;
  gitDocsState: GitDocsStateRepository;
  confluencePageMap: ConfluencePageMapRepository;
  tokens: TokenStore;
}

/**
 * Generator ids that trigger auto-push. These are the runs that mutate spec
 * items; anything else (bootstrap, readme, captures, the pushes themselves)
 * is filtered out — explicitly, to prevent push→push chains.
 */
const TRIGGER_GENERATORS = new Set(["enrichment-pipeline", "full-tree-spec"]);

export function installAutoPushOnRunComplete(deps: AutoPushDeps): () => void {
  return deps.worker.onRunCompleted((evt: RunCompletedEvent) => {
    // The listener is invoked synchronously from the worker; we kick off the
    // pushes asynchronously and swallow rejections so they can't crash the
    // worker loop or mask the run's real status.
    void maybeAutoPush(evt, deps).catch((err) => {
      process.stderr.write(
        `[auto-push] unhandled error for run ${evt.runId}: ${(err as Error).message}\n`,
      );
    });
  });
}

async function maybeAutoPush(evt: RunCompletedEvent, deps: AutoPushDeps): Promise<void> {
  if (evt.status !== "success") return;
  if (!TRIGGER_GENERATORS.has(evt.generatorId)) return;

  const project = deps.projects.findById(evt.projectId);
  if (!project) {
    process.stderr.write(
      `[auto-push] project ${evt.projectId} not found for run ${evt.runId}; skipping\n`,
    );
    return;
  }

  // Fire both pushes in parallel — they target independent backends and
  // the user gets the same end-state either way. Per-trigger failures are
  // logged but don't block the other one.
  const tasks: Array<Promise<void>> = [];
  if (isGitDocsAutoPushEnabled(project)) {
    tasks.push(triggerGitDocsAutoPush(project, deps, evt.runId));
  }
  if (isConfluenceAutoPushEnabled(project)) {
    tasks.push(triggerConfluenceAutoPush(project, deps, evt.runId));
  }
  await Promise.allSettled(tasks);
}

// ---------------------------------------------------------------------------
// Git /docs
// ---------------------------------------------------------------------------

function isGitDocsAutoPushEnabled(project: Project): boolean {
  const cfg = (project.connectors as { gitDocs?: { autoPush?: unknown; cloneUrl?: unknown } })
    .gitDocs;
  if (!cfg || typeof cfg !== "object") return false;
  return cfg.autoPush === true && typeof cfg.cloneUrl === "string" && cfg.cloneUrl.length > 0;
}

async function triggerGitDocsAutoPush(
  project: Project,
  deps: AutoPushDeps,
  triggerRunId: string,
): Promise<void> {
  // Token presence check is also done inside runGitDocsPush, but we want a
  // clean "skipping" log message rather than an error-shaped one when the
  // user hasn't saved a token yet.
  const tokenValue = await deps.tokens.get({ projectId: project.id, provider: "github" });
  if (!tokenValue || tokenValue.provider !== "github") {
    process.stdout.write(
      `[auto-push] git-docs auto-push enabled for project ${project.id} but no GitHub token stored; skipping\n`,
    );
    return;
  }

  try {
    const result = await runGitDocsPush({
      project,
      gitDocsState: deps.gitDocsState,
      tokens: deps.tokens,
    });
    process.stdout.write(
      `[auto-push] git-docs after run ${triggerRunId} → run ${result.runId}; ` +
        `${result.filesWritten} file(s), pushedSha=${result.pushedSha ?? "none"}\n`,
    );
  } catch (err) {
    process.stderr.write(
      `[auto-push] git-docs failed after run ${triggerRunId}: ${(err as Error).message}\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// Confluence
// ---------------------------------------------------------------------------

interface ConfluenceCfg {
  spaceKey: string;
  parentPageId?: string;
  autoPush?: boolean;
}

function isConfluenceAutoPushEnabled(project: Project): boolean {
  const cfg = (project.connectors as { confluence?: ConfluenceCfg }).confluence;
  if (!cfg || typeof cfg !== "object") return false;
  return cfg.autoPush === true && typeof cfg.spaceKey === "string" && cfg.spaceKey.length > 0;
}

async function triggerConfluenceAutoPush(
  project: Project,
  deps: AutoPushDeps,
  triggerRunId: string,
): Promise<void> {
  const cfg = (project.connectors as { confluence?: ConfluenceCfg }).confluence;
  if (!cfg) return;

  const tokenValue = await deps.tokens.get({ projectId: project.id, provider: "confluence" });
  if (!tokenValue || tokenValue.provider !== "confluence") {
    process.stdout.write(
      `[auto-push] confluence auto-push enabled for project ${project.id} but no Confluence token stored; skipping\n`,
    );
    return;
  }

  try {
    const client = new ConfluenceClient({
      baseUrl: tokenValue.baseUrl,
      email: tokenValue.email,
      apiToken: tokenValue.apiToken,
    });
    const pushService = new ConfluencePushService(client, deps.confluencePageMap);
    const profileId = (project.ai as { profileId?: string } | undefined)?.profileId ?? "pm-spec";

    const runId = deps.worker.enqueue({
      projectId: project.id,
      generatorId: "confluence-push",
      profileId,
      options: {
        confluencePushService: pushService,
        projectId: project.id,
        spaceKey: cfg.spaceKey,
        parentPageId: cfg.parentPageId,
      },
    });
    process.stdout.write(
      `[auto-push] confluence after run ${triggerRunId} → enqueued run ${runId}\n`,
    );
  } catch (err) {
    process.stderr.write(
      `[auto-push] confluence failed after run ${triggerRunId}: ${(err as Error).message}\n`,
    );
  }
}
