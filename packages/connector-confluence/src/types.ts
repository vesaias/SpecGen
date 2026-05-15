/**
 * Config + error types for the Confluence push connector (Tasks F.4-F.8).
 *
 * The connector consumes a SpecRepository snapshot, walks each item into ADF
 * (Atlassian Document Format), and creates/updates/archives pages via the
 * Confluence Cloud REST API v2. Page identity is persisted via the
 * ConfluencePageMap rows so we can re-sync without title-based lookup.
 */

/**
 * Minimal ADF node shape — we only emit the subset listed in the F.5 mapping
 * table. The `version: 1` literal on AdfDoc matches the Confluence schema
 * marker; everything else is structural.
 */
export interface AdfDoc {
  version: 1;
  type: "doc";
  content: AdfNode[];
}

export interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
}

/**
 * Credentials needed to authenticate against Confluence Cloud. The connector
 * NEVER persists these on disk — they live inside the encrypted TokenStore and
 * are passed in per-request.
 */
export interface ConfluenceCredentials {
  /**
   * Base site URL, e.g. `https://acme.atlassian.net`. The client strips a
   * trailing slash and joins `/wiki/<path>` for every request, so the value
   * provided here must NOT already include `/wiki`.
   */
  baseUrl: string;
  email: string;
  apiToken: string;
}

/**
 * Discriminator for `ConfluencePageMap.kind`. `"item"` is the original behaviour
 * — one row per spec item. `"folder"` is the tree-aware addition (v0.3): rows
 * for `spec.tree` folder nodes so we can mirror the sidebar tree as a real
 * Confluence page hierarchy.
 */
export type ConfluencePageKind = "item" | "folder";

/**
 * Page-map row shape — mirrored from the SQLite schema in 004 + 005.
 * Lives here (in the connector package) so the package can stay agnostic of the
 * server's SQLite layer; the server's ConfluencePageMapRepository satisfies the
 * accompanying interface below.
 *
 * `kind` discriminates between spec-item pages and tree-folder pages. The
 * `item_id` column is reused as the folder's tree-node id when kind = "folder".
 * `parent_page_id` is the last-cached Confluence parent id; the push service
 * compares it to the current tree position to detect a move and PUT the
 * relocated page's `parentId`.
 */
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

/**
 * Minimum repository surface the push service needs. Defined in connector-confluence
 * so the connector package doesn't depend on the server's SQLite implementation
 * (which would create a server↔connector cycle). The server's
 * ConfluencePageMapRepository structurally satisfies this interface.
 *
 * All lookups + writes are keyed on `(projectId, kind, itemId)` so the same
 * table can carry both item and folder rows without ambiguity.
 */
export interface ConfluencePageMapRepositoryLike {
  findByItem(projectId: string, kind: ConfluencePageKind, itemId: string): ConfluencePageMap | null;
  listByProject(projectId: string): ConfluencePageMap[];
  upsert(map: ConfluencePageMap): void;
  tombstone(projectId: string, kind: ConfluencePageKind, itemId: string, at: string): void;
}

/**
 * Config for a single push invocation. spaceKey is required to look up the
 * space id; parentPageId is optional and applies to newly-created pages only
 * (existing pages stay where they are to respect manual moves in Confluence).
 */
export interface ConfluencePushConfig {
  projectId: string;
  spaceKey: string;
  parentPageId?: string;
  /** Optional progress logger — surfaced to the REST handler for run logs. */
  onProgress?: (msg: string) => void;
}

export interface ConfluencePushResult {
  created: number;
  updated: number;
  archived: number;
}

/**
 * Streaming progress event yielded by `ConfluencePushService.pushIterable()`.
 *
 * - `progress` is emitted at phase boundaries and once per page so the
 *   webapp's ProgressDrawer can show per-page counters ("Updating 12/34").
 * - `done` carries the final create/update/archive totals and is always the
 *   last event of a successful push.
 *
 * Generator wrappers (e.g. core's `confluence-push` generator) translate
 * these into the broader `GeneratorEvent` shape — `done` here becomes a
 * `done` with a full RunSummary; `progress.message` is passed through.
 */
export type ConfluencePushEvent =
  | { type: "progress"; message: string }
  | { type: "done"; result: ConfluencePushResult };

/**
 * Thrown when a page operation conflicts with the remote (e.g. version stale).
 * Reserved for future drift-detection — currently the service surfaces these
 * via raw error messages from ConfluenceClient.
 */
export class ConfluencePushConflictError extends Error {
  constructor(
    message: string,
    readonly remotePageId: string,
    readonly remoteVersion: number,
  ) {
    super(message);
    this.name = "ConfluencePushConflictError";
  }
}
