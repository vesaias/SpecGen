import type { DatabaseSync } from "node:sqlite";
import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import type { RunCompletedEvent, RunWorker } from "./RunWorker.js";

export interface MarkParsedDeps {
  worker: RunWorker;
  projects: SqliteProjectRepository;
  /** Used once on install to backfill last_parsed_at for projects that
   * already have successful runs but never had the column written. */
  db?: DatabaseSync;
}

const PARSE_GENERATORS = new Set(["full-tree-spec", "enrichment-pipeline"]);

/**
 * Stamp `projects.last_parsed_at` whenever a successful parse-or-pipeline run
 * completes. Drives the "parsed X" / "never parsed" hint on the dashboard.
 *
 * Why include `enrichment-pipeline`: the pipeline orchestrates a full-tree-spec
 * sub-run internally, so a successful pipeline implies a successful parse. We
 * want the timestamp updated whether the user clicked "Update" (which fires
 * full-tree-spec directly) or "Rebuild" (which fires the pipeline).
 */
export function installMarkProjectParsed(deps: MarkParsedDeps): () => void {
  // One-time backfill so existing projects with prior successful runs stop
  // showing "never parsed" on the dashboard. Idempotent: only fills NULLs.
  if (deps.db) {
    try {
      deps.db
        .prepare(`
          UPDATE projects
             SET last_parsed_at = (
               SELECT MAX(finished_at)
                 FROM runs
                WHERE runs.project_id = projects.id
                  AND runs.status = 'success'
                  AND runs.generator_id IN ('full-tree-spec', 'enrichment-pipeline')
                  AND runs.finished_at IS NOT NULL
             )
           WHERE last_parsed_at IS NULL
             AND id IN (
               SELECT project_id FROM runs
                WHERE status = 'success'
                  AND generator_id IN ('full-tree-spec', 'enrichment-pipeline')
                  AND finished_at IS NOT NULL
             )
        `)
        .run();
    } catch (err) {
      process.stderr.write(`[mark-parsed] backfill failed: ${(err as Error).message}\n`);
    }
  }

  return deps.worker.onRunCompleted((evt: RunCompletedEvent) => {
    try {
      if (evt.status !== "success") return;
      if (!PARSE_GENERATORS.has(evt.generatorId)) return;
      deps.projects.markParsed(evt.projectId);
    } catch (err) {
      process.stderr.write(
        `[mark-parsed] failed to stamp project ${evt.projectId}: ${(err as Error).message}\n`,
      );
    }
  });
}
