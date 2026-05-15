import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import type { SqliteRunRepository } from "../repositories/SqliteRunRepository.js";
import type { RunCompletedEvent, RunWorker } from "./RunWorker.js";

export interface AutoEnrichDeps {
  worker: RunWorker;
  projects: SqliteProjectRepository;
  runs: SqliteRunRepository;
}

/**
 * Design choice: Option A from the Task 9 plan.
 *
 * We attach a listener to RunWorker.onRunCompleted and react after a
 * full-tree-spec run finishes. This keeps the trigger logic out of the
 * /runs request handler — the parse run might come from the webapp, the
 * CLI, or future automation, and all of them should get the same auto-
 * enrichment behaviour.
 *
 * The pipeline is auto-enqueued when ALL of the following hold:
 *   1. The completed run was a successful `full-tree-spec` run with
 *      `itemsCreated > 0` (so we only fire on the genuinely-initial parse,
 *      not on re-parses that only update or remove items).
 *   2. No PRIOR successful `full-tree-spec` run exists for this project.
 *      This is the second guard that distinguishes "initial parse" from
 *      "re-parse with non-zero itemsCreated" — e.g. a re-parse that
 *      discovers new items after the user added a controller.
 *   3. The project has a usable AI provider configured (not undefined and
 *      not the "local" stub). Without AI, an "initial" pipeline would just
 *      shuffle TODOs around for no gain; we silently skip and let the user
 *      configure AI and manually trigger later.
 *
 * Failures are swallowed (logged to stderr) — auto-enrichment is an
 * enhancement, not a contract the user is depending on.
 */
export function installAutoEnrichOnInitialParse(deps: AutoEnrichDeps): () => void {
  return deps.worker.onRunCompleted((evt: RunCompletedEvent) => {
    try {
      maybeEnqueueEnrichmentPipeline(evt, deps);
    } catch (err) {
      process.stderr.write(
        `[auto-enrich] failed to evaluate trigger for run ${evt.runId}: ${
          (err as Error).message
        }\n`,
      );
    }
  });
}

function maybeEnqueueEnrichmentPipeline(evt: RunCompletedEvent, deps: AutoEnrichDeps): void {
  if (evt.generatorId !== "full-tree-spec") return;
  if (evt.status !== "success") return;
  if (evt.summary.itemsCreated <= 0) return;

  // Guard 2: not an initial parse if a prior full-tree-spec success exists.
  // This list is small in practice (one row per parse run), and the worker
  // runs at concurrency=1, so the race window with another simultaneous
  // parse is effectively closed.
  const priorRuns = deps.runs.listByProjectId(evt.projectId);
  const priorSuccess = priorRuns.find(
    (r) => r.id !== evt.runId && r.generator_id === "full-tree-spec" && r.status === "success",
  );
  if (priorSuccess) return;

  // Guard 3: AI must be configured. Anything that isn't the "local" stub or
  // an empty/undefined provider counts as usable.
  const project = deps.projects.findById(evt.projectId);
  if (!project) return;
  const ai = project.ai as { provider?: string; profileId?: string } | undefined;
  const provider = ai?.provider;
  if (!provider || provider === "local") return;

  const profileId = ai?.profileId ?? evt.profileId ?? "pm-spec";
  const followUpId = deps.worker.enqueue({
    projectId: evt.projectId,
    generatorId: "enrichment-pipeline",
    profileId,
    options: { mode: "initial" },
  });
  process.stdout.write(
    `[auto-enrich] initial parse ${evt.runId} succeeded with ${evt.summary.itemsCreated} new item(s); enqueued enrichment-pipeline run ${followUpId} (mode: initial)\n`,
  );
}
