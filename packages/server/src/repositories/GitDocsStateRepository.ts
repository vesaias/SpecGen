import type { Db } from "../db/sqlite.js";

/**
 * One row per project, tracking the last successful Git /docs push (Task D.6).
 *
 *  - `last_pushed_sha`   — commit we created on the docs branch
 *  - `last_source_sha`   — the source-repo commit we materialized docs from
 *  - `last_run_id`       — opaque run identifier, format `git_<ULID>`
 *  - `last_pushed_at`    — ISO-8601 timestamp
 */
export interface GitDocsState {
  project_id: string;
  last_pushed_sha: string | null;
  last_source_sha: string | null;
  last_run_id: string | null;
  last_pushed_at: string | null;
}

export class GitDocsStateRepository {
  constructor(private readonly db: Db) {}

  findByProjectId(projectId: string): GitDocsState | null {
    const row = this.db
      .prepare("SELECT * FROM git_docs_state WHERE project_id = ?")
      .get(projectId) as unknown as GitDocsState | undefined;
    return row ?? null;
  }

  upsert(state: GitDocsState): void {
    this.db
      .prepare(
        `INSERT INTO git_docs_state
           (project_id, last_pushed_sha, last_source_sha, last_run_id, last_pushed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (project_id) DO UPDATE SET
           last_pushed_sha = excluded.last_pushed_sha,
           last_source_sha = excluded.last_source_sha,
           last_run_id     = excluded.last_run_id,
           last_pushed_at  = excluded.last_pushed_at`,
      )
      .run(
        state.project_id,
        state.last_pushed_sha,
        state.last_source_sha,
        state.last_run_id,
        state.last_pushed_at,
      );
  }
}
