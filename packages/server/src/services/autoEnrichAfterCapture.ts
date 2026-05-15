import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import type { RunCompletedEvent, RunWorker } from "./RunWorker.js";

export interface AutoEnrichAfterCaptureDeps {
  worker: RunWorker;
  projects: SqliteProjectRepository;
}

/**
 * After a successful `frontend-capture` run, enqueue an `enrich-items` run
 * scoped to the captured itemIds. This is what turns capture from "writes a
 * screenshot + observations to disk" into "AI actually re-describes the page
 * using what Playwright saw".
 *
 * Why `enrich-items` and NOT `enrichment-pipeline`: the pipeline runs
 * full-tree-spec under the hood, which re-parses the entire repo. With
 * parser-llm in play, per-file non-determinism shuffles + removes sibling
 * items every time. `enrich-items` reads existing items by id and runs AI
 * in-place — no parser, no tree changes, no removals.
 *
 * The capture generator surfaces the list of items it touched on the run
 * summary's `capturedItemIds`. We forward those as the `itemIds` filter so
 * AI work is contained to pages that genuinely have new observations.
 *
 * Skips silently when:
 *   - The completed run isn't a successful frontend-capture
 *   - The summary has no `capturedItemIds` (capture wrote nothing useful)
 *   - The project's AI provider is unset or "local" (no AI to run)
 *
 * Failures are logged but never thrown — auto-enrichment is best-effort.
 */
export function installAutoEnrichAfterCapture(deps: AutoEnrichAfterCaptureDeps): () => void {
  return deps.worker.onRunCompleted((evt: RunCompletedEvent) => {
    try {
      maybeEnqueueAfterCapture(evt, deps);
    } catch (err) {
      process.stderr.write(
        `[auto-enrich-capture] failed to evaluate trigger for run ${evt.runId}: ${
          (err as Error).message
        }\n`,
      );
    }
  });
}

function maybeEnqueueAfterCapture(evt: RunCompletedEvent, deps: AutoEnrichAfterCaptureDeps): void {
  if (evt.generatorId !== "frontend-capture") return;
  if (evt.status !== "success") return;

  const itemIds = evt.summary.capturedItemIds;
  if (!Array.isArray(itemIds) || itemIds.length === 0) return;

  const project = deps.projects.findById(evt.projectId);
  if (!project) return;
  const ai = project.ai as { provider?: string; profileId?: string } | undefined;
  const provider = ai?.provider;
  if (!provider || provider === "local") {
    process.stdout.write(
      `[auto-enrich-capture] capture run ${evt.runId} captured ${itemIds.length} item(s) but project ${evt.projectId} has no usable AI provider; skipping enrichment\n`,
    );
    return;
  }

  const profileId = ai?.profileId ?? evt.profileId ?? "pm-spec";
  // Use `enrich-items`, NOT `enrichment-pipeline`. The pipeline goes through
  // full-tree-spec, which always re-runs parsers and rebuilds the tree — that
  // path is destructive when the parser is non-deterministic (parser-llm in
  // particular), and it triggers smart-tree shuffles we don't want after a
  // capture. enrich-items reads existing items by id, runs AI in-place, and
  // writes them back. No parse, no tree changes, no removals.
  const followUpId = deps.worker.enqueue({
    projectId: evt.projectId,
    generatorId: "enrich-items",
    profileId,
    options: { itemIds },
  });
  process.stdout.write(
    `[auto-enrich-capture] capture ${evt.runId} → enrich-items ${followUpId} (${itemIds.length} item(s))\n`,
  );
}
