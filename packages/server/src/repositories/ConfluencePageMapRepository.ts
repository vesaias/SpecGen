import type { Db } from "../db/sqlite.js";

/**
 * One row per (project, kind, item) → Confluence page mapping.
 *
 * - kind = "item"   → SpecGen spec-item page (the original v0.2 behaviour).
 * - kind = "folder" → spec.tree folder-node page (v0.3 tree-aware push). The
 *   `item_id` column is reused as the tree-node id in this case.
 *
 * `parent_page_id` is the last-cached Confluence parent id; ConfluencePushService
 * compares it to the current tree position to issue a `PUT /pages/:id` with a
 * new `parentId` when the user has reorganised the spec tree between pushes.
 *
 * Field semantics match the SQL in 004_confluence_page_map.sql +
 * 005_confluence_page_map_kind.sql. Implements the
 * `ConfluencePageMapRepositoryLike` interface from @specgen/connector-confluence
 * structurally — that interface lives in the connector package so the connector
 * never depends on the server's SQLite layer.
 */
export type ConfluencePageKind = "item" | "folder";

export interface ConfluencePageMap {
  project_id: string;
  kind: ConfluencePageKind;
  item_id: string;
  space_id: string;
  page_id: string;
  page_version: number;
  parent_page_id: string | null;
  remote_title: string | null;
  content_hash: string | null;
  tombstoned_at: string | null;
  last_synced_at: string;
}

export class ConfluencePageMapRepository {
  constructor(private readonly db: Db) {}

  findByItem(
    projectId: string,
    kind: ConfluencePageKind,
    itemId: string,
  ): ConfluencePageMap | null {
    const row = this.db
      .prepare(
        "SELECT * FROM confluence_page_map WHERE project_id = ? AND kind = ? AND item_id = ?",
      )
      .get(projectId, kind, itemId) as unknown as ConfluencePageMap | undefined;
    return row ?? null;
  }

  listByProject(projectId: string): ConfluencePageMap[] {
    return this.db
      .prepare("SELECT * FROM confluence_page_map WHERE project_id = ? ORDER BY kind, item_id")
      .all(projectId) as unknown as ConfluencePageMap[];
  }

  upsert(map: ConfluencePageMap): void {
    this.db
      .prepare(
        `INSERT INTO confluence_page_map
           (project_id, kind, item_id, space_id, page_id, page_version,
            parent_page_id, remote_title, content_hash, tombstoned_at, last_synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (project_id, kind, item_id) DO UPDATE SET
           space_id       = excluded.space_id,
           page_id        = excluded.page_id,
           page_version   = excluded.page_version,
           parent_page_id = excluded.parent_page_id,
           remote_title   = excluded.remote_title,
           content_hash   = excluded.content_hash,
           tombstoned_at  = excluded.tombstoned_at,
           last_synced_at = excluded.last_synced_at`,
      )
      .run(
        map.project_id,
        map.kind,
        map.item_id,
        map.space_id,
        map.page_id,
        map.page_version,
        map.parent_page_id,
        map.remote_title,
        map.content_hash,
        map.tombstoned_at,
        map.last_synced_at,
      );
  }

  tombstone(projectId: string, kind: ConfluencePageKind, itemId: string, at: string): void {
    this.db
      .prepare(
        "UPDATE confluence_page_map SET tombstoned_at = ? WHERE project_id = ? AND kind = ? AND item_id = ?",
      )
      .run(at, projectId, kind, itemId);
  }
}
