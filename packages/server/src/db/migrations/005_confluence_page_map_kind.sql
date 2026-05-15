-- 005_confluence_page_map_kind.sql — extend confluence_page_map with a `kind`
-- column so a single table maps both items and tree folders to Confluence pages.
--
-- Rationale: the v0.2 push placed every item under `parentPageId` as a flat
-- sibling list. To mirror the SpecGen sidebar tree as a real Confluence page
-- hierarchy we also need to track folder→page mappings. A single table with a
-- discriminator column keeps the query path uniform (vs. a parallel
-- confluence_folder_map table) and reuses the same upsert/tombstone semantics.
--
-- `kind` is "item" for spec-item rows (the previous behaviour) and "folder"
-- for tree-folder rows. The `item_id` column is repurposed as the folder's
-- stable id (spec.tree node id) when kind = "folder". The (project_id, item_id)
-- pair is no longer unique on its own — a project could in theory have a
-- folder node id colliding with an item id — so the primary key is broadened
-- to include `kind`.
--
-- Existing rows are migrated to kind = "item" with the data preserved.

-- SQLite doesn't support ADD CONSTRAINT or modifying a primary key in place,
-- so we rebuild the table.
CREATE TABLE confluence_page_map_new (
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'item',          -- 'item' | 'folder'
  item_id        TEXT NOT NULL,                          -- spec item id OR tree folder node id
  space_id       TEXT NOT NULL,
  page_id        TEXT NOT NULL,
  page_version   INTEGER NOT NULL,
  parent_page_id TEXT,                                   -- last-cached Confluence parent id; used for move detection
  remote_title   TEXT,
  content_hash   TEXT,
  tombstoned_at  TEXT,
  last_synced_at TEXT NOT NULL,
  PRIMARY KEY (project_id, kind, item_id)
);

INSERT INTO confluence_page_map_new
  (project_id, kind, item_id, space_id, page_id, page_version,
   parent_page_id, remote_title, content_hash, tombstoned_at, last_synced_at)
SELECT
  project_id, 'item', item_id, space_id, page_id, page_version,
  NULL, remote_title, content_hash, tombstoned_at, last_synced_at
FROM confluence_page_map;

DROP TABLE confluence_page_map;
ALTER TABLE confluence_page_map_new RENAME TO confluence_page_map;

-- Recreate the (project_id, page_id) index that 004 created.
CREATE INDEX idx_confluence_map_page ON confluence_page_map(project_id, page_id);
