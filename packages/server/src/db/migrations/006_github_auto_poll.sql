-- 006_github_auto_poll.sql — Track the last-seen upstream SHA per project so
-- the GitHub commit poller can detect when the source branch has moved and
-- enqueue an automatic enrichment-pipeline run.
--
-- The poller writes `github_last_seen_sha` after every successful check
-- (regardless of whether a run was triggered). A NULL means "never polled"
-- and the first tick records the current sha WITHOUT triggering a run —
-- otherwise opting a project in would always fire one run immediately.
--
-- One column on `projects` rather than a new table: state is small, scoped
-- 1:1 to the project, and naturally cleaned up via ON DELETE CASCADE.

ALTER TABLE projects ADD COLUMN github_last_seen_sha TEXT NULL;
