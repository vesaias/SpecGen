-- 004_confluence_page_map.sql — Confluence push connector page mapping (Task F.6)
--
-- One row per (project_id, item_id) → Confluence page. Lets us re-sync without
-- title-based lookup: even if a user renames a page in Confluence, we still
-- find it because the row pins the page_id.
--
--   project_id   — FK to projects.id
--   item_id      — SpecGen spec item id (string, max 100 chars in practice)
--   space_id     — Confluence space id (string, opaque)
--   page_id      — Confluence page id (string, opaque)
--   page_version — last version we PUT to Confluence; the next update bumps to +1
--   remote_title — last title we set on the page (informational)
--   content_hash — sha256 of last-pushed ADF; reserved for v0.3 drift detection
--   tombstoned_at — ISO-8601 marker set when the page was archived (item removed
--                   from the spec). Reversible — re-creating the item un-tombs
--                   on the next push (logic owned by ConfluencePushService).
--   last_synced_at — ISO-8601 timestamp of the last successful create/update.

CREATE TABLE confluence_page_map (
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_id        TEXT NOT NULL,
  space_id       TEXT NOT NULL,
  page_id        TEXT NOT NULL,
  page_version   INTEGER NOT NULL,
  remote_title   TEXT,
  content_hash   TEXT,
  tombstoned_at  TEXT,
  last_synced_at TEXT NOT NULL,
  PRIMARY KEY (project_id, item_id)
);

CREATE INDEX idx_confluence_map_page ON confluence_page_map(project_id, page_id);
