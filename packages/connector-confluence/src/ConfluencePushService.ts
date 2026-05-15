/**
 * ConfluencePushService — tree-aware Confluence push.
 *
 * The push mirrors the SpecGen sidebar tree (`spec.tree`) as a real Confluence
 * page hierarchy. Folder nodes become parent pages; item leaves become child
 * pages under their respective folder. Three passes:
 *
 *   Pass A — folder pages, top-down. Walk `spec.tree`. For each folder node,
 *     create-or-update a Confluence page whose `parent` is the folder's parent
 *     folder's page (or `cfg.parentPageId` for top-level folders). Persist the
 *     resulting page id in `confluence_page_map` keyed on (project, "folder",
 *     folder.id). The folder page body is a short index linking its children.
 *
 *   Pass 1 — item pages, with stub links. For each spec item, find its parent
 *     folder via the tree, look that folder's now-known page id, and
 *     create-or-update the item's page with `parentId = <folder page id>` (or
 *     `cfg.parentPageId` if the item is at the tree root). If the item's
 *     cached `parent_page_id` differs from the current one, issue a parent
 *     move via `client.updatePageParent`. Cross-item `#item-id` links render
 *     as plain text in this pass — decision F8: targets may not exist yet.
 *
 *   Pass 2 — item pages, with resolved links. Re-render every item with the
 *     `resolveItemUrl` callback wired to the now-fully-populated page map and
 *     PUT every page again.
 *
 *   Archive pass — items in the page map but not in the current spec get
 *     `archivePage` (soft delete, reversible) and a tombstone marker. Folders
 *     in the page map but not in the current tree are archived the same way;
 *     Confluence cascades the trash to descendants automatically.
 *
 * The service is stateless across calls — all persistence lives in the
 * ConfluencePageMapRepositoryLike.
 *
 * Two public entry points:
 *
 *   - `pushIterable(repo, cfg)` — async generator yielding `progress` events
 *     per-page + a final `done` event with totals. Consumed by the streaming
 *     `confluence-push` generator so the webapp can render live progress.
 *   - `push(repo, cfg)` — thin awaitable wrapper that drains `pushIterable`
 *     and returns the final totals.
 */

import type { Block, Spec, SpecItem, SpecRepository, TreeNode } from "@specgen/core";
import type { ConfluenceClient } from "./ConfluenceClient.js";
import { renderItemAdf } from "./renderItemAdf.js";
import type {
  AdfDoc,
  AdfNode,
  ConfluencePageMapRepositoryLike,
  ConfluencePushConfig,
  ConfluencePushEvent,
  ConfluencePushResult,
} from "./types.js";

type SpecItemWithBlocks = SpecItem & { blocks?: Block[] };

/**
 * Flattened folder descriptor — what we need to plan + execute pass A in a
 * single sequence without recursing per row.
 */
interface FolderNode {
  /** Stable id from `spec.tree` (TreeNode.id for the folder). */
  id: string;
  /** Display label; falls back to the id if a folder somehow has no label. */
  label: string;
  /** Parent folder id, or null if this folder is at the tree root. */
  parentFolderId: string | null;
  /** Direct children for the auto-generated index body. */
  childItemIds: string[];
  childFolderIds: string[];
}

/**
 * Item placement: for each item id we record which folder it lives under
 * (null if it sits at the tree root, or if the tree has no entry for it).
 */
type ItemPlacement = Map<string, { parentFolderId: string | null }>;

export class ConfluencePushService {
  constructor(
    private readonly client: ConfluenceClient,
    private readonly pageMap: ConfluencePageMapRepositoryLike,
  ) {}

  /**
   * Async-generator variant of `push`. Yields a `progress` event at every
   * meaningful step (auth, plan, per-page create/update, archive) and a
   * single terminal `done` event carrying the totals.
   */
  async *pushIterable(
    spec: SpecRepository,
    cfg: ConfluencePushConfig,
  ): AsyncGenerator<ConfluencePushEvent, void, void> {
    yield {
      type: "progress",
      message: `Connecting to Confluence — looking up space ${cfg.spaceKey}…`,
    };
    cfg.onProgress?.(`Looking up space ${cfg.spaceKey}`);
    const space = await this.client.findSpace(cfg.spaceKey);
    yield {
      type: "progress",
      message: `Authenticated — space ${space.key} (${space.id})`,
    };

    yield { type: "progress", message: "Reading spec snapshot…" };
    cfg.onProgress?.("Reading spec snapshot");
    const snap = await spec.snapshot();
    const items = snap.items as Record<string, SpecItemWithBlocks>;
    const itemEntries = Object.entries(items);

    // Flatten the tree once — we walk folders top-down for pass A and reuse
    // the same plan to determine each item's parent folder for pass 1.
    const { folders, placement } = flattenTree(snap.spec.tree);
    const liveFolderIds = new Set(folders.map((f) => f.id));
    const liveItemIds = new Set(Object.keys(items));

    // Plan ----------------------------------------------------------------
    let plannedFolderCreates = 0;
    let plannedFolderUpdates = 0;
    for (const f of folders) {
      const existing = this.pageMap.findByItem(cfg.projectId, "folder", f.id);
      if (existing && !existing.tombstoned_at) plannedFolderUpdates++;
      else plannedFolderCreates++;
    }
    let plannedItemCreates = 0;
    let plannedItemUpdates = 0;
    for (const [id] of itemEntries) {
      const existing = this.pageMap.findByItem(cfg.projectId, "item", id);
      if (existing && !existing.tombstoned_at) plannedItemUpdates++;
      else plannedItemCreates++;
    }
    const allRows = this.pageMap.listByProject(cfg.projectId);
    const plannedItemArchives = allRows.filter(
      (r) => r.kind === "item" && !r.tombstoned_at && !liveItemIds.has(r.item_id),
    ).length;
    const plannedFolderArchives = allRows.filter(
      (r) => r.kind === "folder" && !r.tombstoned_at && !liveFolderIds.has(r.item_id),
    ).length;

    yield {
      type: "progress",
      message:
        `Plan: ${folders.length} folder(s) (${plannedFolderCreates} create, ${plannedFolderUpdates} update), ` +
        `${itemEntries.length} item(s) (${plannedItemCreates} create, ${plannedItemUpdates} update), ` +
        `${plannedFolderArchives + plannedItemArchives} archive`,
    };

    let created = 0;
    let updated = 0;

    // ---------------------------------------------------------------------
    // Pass A — folder pages, top-down. Folders are already in BFS order in
    // `folders` (see flattenTree) so the parent's page id is always known by
    // the time we reach a child folder.
    // ---------------------------------------------------------------------
    const folderPageId = new Map<string, string>(); // folder.id → confluence page id
    cfg.onProgress?.(`Pass A — ${folders.length} folder(s)`);
    yield {
      type: "progress",
      message: `Pass A/3 — pushing ${folders.length} folder page(s) top-down`,
    };
    let fi = 0;
    for (const folder of folders) {
      fi++;
      const desiredParent = this.resolveFolderParent(folder, folderPageId, cfg);
      const indexBody = buildFolderIndexBody(folder, items);
      const existing = this.pageMap.findByItem(cfg.projectId, "folder", folder.id);

      if (existing && !existing.tombstoned_at) {
        yield {
          type: "progress",
          message: `Updating folder ${fi}/${folders.length} — ${folder.label}`,
        };
        const r = await this.client.updatePage({
          id: existing.page_id,
          version: existing.page_version,
          title: folder.label,
          adfBody: indexBody,
        });
        const parentChanged = existing.parent_page_id !== (desiredParent ?? null);
        let nextVersion = r.version.number;
        if (parentChanged) {
          const r2 = await this.client.updatePageParent({
            id: existing.page_id,
            version: nextVersion,
            title: folder.label,
            parentId: desiredParent,
          });
          nextVersion = r2.version.number;
        }
        this.pageMap.upsert({
          ...existing,
          page_version: nextVersion,
          parent_page_id: desiredParent ?? null,
          remote_title: folder.label,
          last_synced_at: new Date().toISOString(),
        });
        folderPageId.set(folder.id, existing.page_id);
        updated++;
      } else {
        yield {
          type: "progress",
          message: `Creating folder ${fi}/${folders.length} — ${folder.label}`,
        };
        const r = await this.client.createPage({
          spaceId: space.id,
          title: folder.label,
          parentId: desiredParent,
          adfBody: indexBody,
        });
        this.pageMap.upsert({
          project_id: cfg.projectId,
          kind: "folder",
          item_id: folder.id,
          space_id: space.id,
          page_id: r.id,
          page_version: r.version.number,
          parent_page_id: desiredParent ?? null,
          remote_title: folder.label,
          content_hash: null,
          tombstoned_at: null,
          last_synced_at: new Date().toISOString(),
        });
        folderPageId.set(folder.id, r.id);
        created++;
      }
    }

    // ---------------------------------------------------------------------
    // Pass 1: create or update every live item with stub-link ADF, parented
    // under its folder page (or `cfg.parentPageId` for root-level items).
    // ---------------------------------------------------------------------
    cfg.onProgress?.(`Pass 1 — ${itemEntries.length} item(s)`);
    yield {
      type: "progress",
      message: `Pass 1/3 — pushing ${itemEntries.length} item page(s) with stub links`,
    };
    let i = 0;
    for (const [id, item] of itemEntries) {
      i++;
      const adf = renderItemAdf(item, { stubLinks: true });
      const place = placement.get(id);
      const desiredParent = place?.parentFolderId
        ? folderPageId.get(place.parentFolderId)
        : cfg.parentPageId;
      const existing = this.pageMap.findByItem(cfg.projectId, "item", id);

      if (existing && !existing.tombstoned_at) {
        yield {
          type: "progress",
          message: `Updating ${i}/${itemEntries.length} — ${item.title}`,
        };
        const r = await this.client.updatePage({
          id: existing.page_id,
          version: existing.page_version,
          title: item.title,
          adfBody: adf,
        });
        let nextVersion = r.version.number;
        const parentChanged = existing.parent_page_id !== (desiredParent ?? null);
        if (parentChanged) {
          const r2 = await this.client.updatePageParent({
            id: existing.page_id,
            version: nextVersion,
            title: item.title,
            parentId: desiredParent,
          });
          nextVersion = r2.version.number;
        }
        this.pageMap.upsert({
          ...existing,
          page_version: nextVersion,
          parent_page_id: desiredParent ?? null,
          remote_title: item.title,
          last_synced_at: new Date().toISOString(),
        });
        updated++;
      } else {
        yield {
          type: "progress",
          message: `Creating ${i}/${itemEntries.length} — ${item.title}`,
        };
        const r = await this.client.createPage({
          spaceId: space.id,
          title: item.title,
          parentId: desiredParent,
          adfBody: adf,
        });
        this.pageMap.upsert({
          project_id: cfg.projectId,
          kind: "item",
          item_id: id,
          space_id: space.id,
          page_id: r.id,
          page_version: r.version.number,
          parent_page_id: desiredParent ?? null,
          remote_title: item.title,
          content_hash: null,
          tombstoned_at: null,
          last_synced_at: new Date().toISOString(),
        });
        created++;
      }
    }

    // ---------------------------------------------------------------------
    // Pass 2: re-render with resolved cross-item links and PUT again.
    // ---------------------------------------------------------------------
    cfg.onProgress?.("Pass 2 — resolving links");
    yield {
      type: "progress",
      message: `Pass 2/3 — re-rendering ${itemEntries.length} page(s) with resolved links`,
    };
    const baseUrl = this.client.baseUrl;
    let j = 0;
    for (const [id, item] of itemEntries) {
      j++;
      const entry = this.pageMap.findByItem(cfg.projectId, "item", id);
      if (!entry) continue; // shouldn't happen after pass 1, but be defensive
      const adf = renderItemAdf(item, {
        stubLinks: false,
        resolveItemUrl: (otherId) => {
          const target = this.pageMap.findByItem(cfg.projectId, "item", otherId);
          if (!target || target.tombstoned_at) return null;
          return `${baseUrl}/wiki/spaces/${space.key}/pages/${target.page_id}`;
        },
      });
      yield {
        type: "progress",
        message: `Resolving links ${j}/${itemEntries.length} — ${item.title}`,
      };
      const r = await this.client.updatePage({
        id: entry.page_id,
        version: entry.page_version,
        title: item.title,
        adfBody: adf,
      });
      this.pageMap.upsert({
        ...entry,
        page_version: r.version.number,
        remote_title: item.title,
        last_synced_at: new Date().toISOString(),
      });
    }

    // ---------------------------------------------------------------------
    // Archive pass: items in page_map but not in the snapshot get
    // soft-deleted. Same for folders that disappeared from the tree.
    // Confluence cascades the trash to descendants automatically — archiving
    // a folder page also archives its child pages, so we tombstone the
    // folder row but leave child rows alone (they'll be picked up on the
    // next push when the items they tracked no longer resolve).
    // ---------------------------------------------------------------------
    cfg.onProgress?.("Archive pass — looking for orphaned pages");
    const liveRowCount = allRows.filter((r) => !r.tombstoned_at).length;
    yield {
      type: "progress",
      message: `Archive pass — scanning ${liveRowCount} live row(s) for orphans`,
    };
    let archived = 0;
    const totalArchive = plannedItemArchives + plannedFolderArchives;
    let k = 0;
    for (const entry of this.pageMap.listByProject(cfg.projectId)) {
      if (entry.tombstoned_at) continue;
      const isLive =
        entry.kind === "item" ? liveItemIds.has(entry.item_id) : liveFolderIds.has(entry.item_id);
      if (isLive) continue;
      k++;
      yield {
        type: "progress",
        message: `Archiving ${entry.kind} ${k}/${totalArchive} — ${entry.remote_title ?? entry.item_id}`,
      };
      await this.client.archivePage(entry.page_id);
      this.pageMap.tombstone(cfg.projectId, entry.kind, entry.item_id, new Date().toISOString());
      archived++;
    }

    cfg.onProgress?.(`Done — created ${created}, updated ${updated}, archived ${archived}`);
    yield {
      type: "done",
      result: { created, updated, archived },
    };
  }

  /**
   * Compute the Confluence parent page id for a given folder. A folder at the
   * tree root re-uses `cfg.parentPageId` (the user-configured top-level
   * parent). A nested folder uses the previously-pushed folder's page id —
   * because folders are walked breadth-first, the parent has always been
   * pushed first.
   */
  private resolveFolderParent(
    folder: FolderNode,
    folderPageId: Map<string, string>,
    cfg: ConfluencePushConfig,
  ): string | undefined {
    if (!folder.parentFolderId) return cfg.parentPageId;
    return folderPageId.get(folder.parentFolderId) ?? cfg.parentPageId;
  }

  /**
   * Awaitable wrapper around `pushIterable`. Consumed by callers that don't
   * need per-page streaming.
   */
  async push(spec: SpecRepository, cfg: ConfluencePushConfig): Promise<ConfluencePushResult> {
    let result: ConfluencePushResult = { created: 0, updated: 0, archived: 0 };
    for await (const ev of this.pushIterable(spec, cfg)) {
      if (ev.type === "done") result = ev.result;
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Walk the spec tree once, returning:
 *   - `folders`: every folder node in BFS order (parents always precede
 *     their children), so pass A can push them top-down with each parent
 *     page id already in the map when we reach the child.
 *   - `placement`: per-item parent-folder id (null for items at the tree
 *     root or items not represented in the tree).
 */
function flattenTree(tree: Spec["tree"]): {
  folders: FolderNode[];
  placement: ItemPlacement;
} {
  const folders: FolderNode[] = [];
  const placement: ItemPlacement = new Map();

  type QItem = { node: TreeNode; parentFolderId: string | null };
  const queue: QItem[] = tree.map((n) => ({ node: n, parentFolderId: null }));

  while (queue.length) {
    const { node, parentFolderId } = queue.shift() as QItem;
    if (node.type === "folder") {
      const childItemIds: string[] = [];
      const childFolderIds: string[] = [];
      for (const c of node.children ?? []) {
        if (c.type === "folder") childFolderIds.push(c.id);
        else childItemIds.push(c.id);
      }
      folders.push({
        id: node.id,
        label: node.label || node.id,
        parentFolderId,
        childItemIds,
        childFolderIds,
      });
      // Enqueue children with this folder as their parent.
      for (const c of node.children ?? []) {
        queue.push({ node: c, parentFolderId: node.id });
      }
    } else {
      // Item leaf — record its placement.
      placement.set(node.id, { parentFolderId });
    }
  }

  return { folders, placement };
}

/**
 * Render the auto-generated folder-index page body. The body is intentionally
 * simple — Confluence's tree navigation in the sidebar already shows children,
 * so this page exists primarily so the folder can have a stable parent and so
 * a user landing on it sees a "this is a category" hint plus a quick TOC.
 *
 * Cross-page links are deliberately left as plain text here: at the time a
 * folder is pushed (pass A) we don't yet know the item page ids, and
 * regenerating folder bodies in pass 2 would double the API calls for
 * little value. Confluence's automatic page tree already renders proper
 * navigation links to children.
 */
function buildFolderIndexBody(
  folder: FolderNode,
  items: Record<string, SpecItemWithBlocks>,
): AdfDoc {
  const content: AdfNode[] = [];
  content.push({
    type: "heading",
    attrs: { level: 1 },
    content: [{ type: "text", text: folder.label }],
  });

  const childCount = folder.childItemIds.length + folder.childFolderIds.length;
  const summary =
    childCount === 0
      ? "This folder is currently empty."
      : `This is the ${folder.label} folder. Contains ${childCount} page${childCount === 1 ? "" : "s"}.`;
  content.push({ type: "paragraph", content: [{ type: "text", text: summary }] });

  if (folder.childFolderIds.length || folder.childItemIds.length) {
    content.push({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Contents" }],
    });
    const listItems: AdfNode[] = [];
    for (const fid of folder.childFolderIds) {
      listItems.push({
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: `Folder: ${fid}`, marks: [{ type: "em" }] }],
          },
        ],
      });
    }
    for (const iid of folder.childItemIds) {
      const title = items[iid]?.title ?? iid;
      listItems.push({
        type: "listItem",
        content: [{ type: "paragraph", content: [{ type: "text", text: title }] }],
      });
    }
    content.push({ type: "bulletList", content: listItems });
  }

  return { version: 1, type: "doc", content };
}
