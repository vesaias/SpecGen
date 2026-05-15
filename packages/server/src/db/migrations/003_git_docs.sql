-- 003_git_docs.sql — Git /docs push connector state (Task D.6)
--
-- Tracks the last successful push from `DocsPushService` so that:
--   1. We can implement conflict detection (lastPushedSha vs current remote)
--   2. The UI can show "last pushed at <X>, sha <Y>" without re-cloning
--
-- One row per project. Created on first successful push.

CREATE TABLE git_docs_state (
  project_id      TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  last_pushed_sha TEXT,
  last_source_sha TEXT,
  last_run_id     TEXT,
  last_pushed_at  TEXT
);
