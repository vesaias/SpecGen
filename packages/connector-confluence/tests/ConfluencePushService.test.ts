import type { Spec, SpecItem, SpecRepository, TreeNode } from "@specgen/core";
import { describe, expect, it } from "vitest";
import { ConfluenceClient } from "../src/ConfluenceClient.js";
import { ConfluencePushService } from "../src/ConfluencePushService.js";
import type {
  AdfDoc,
  ConfluencePageKind,
  ConfluencePageMap,
  ConfluencePageMapRepositoryLike,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// In-memory page-map repository — satisfies ConfluencePageMapRepositoryLike.
// The v0.3 (tree-aware) signature includes a `kind` discriminator on every
// lookup; the in-memory store keys rows on (project, kind, item).
// ---------------------------------------------------------------------------

class MemoryPageMap implements ConfluencePageMapRepositoryLike {
  rows = new Map<string, ConfluencePageMap>();

  private k(projectId: string, kind: ConfluencePageKind, itemId: string): string {
    return `${projectId}::${kind}::${itemId}`;
  }

  findByItem(
    projectId: string,
    kind: ConfluencePageKind,
    itemId: string,
  ): ConfluencePageMap | null {
    return this.rows.get(this.k(projectId, kind, itemId)) ?? null;
  }

  listByProject(projectId: string): ConfluencePageMap[] {
    return Array.from(this.rows.values()).filter((r) => r.project_id === projectId);
  }

  upsert(map: ConfluencePageMap): void {
    this.rows.set(this.k(map.project_id, map.kind, map.item_id), { ...map });
  }

  tombstone(projectId: string, kind: ConfluencePageKind, itemId: string, at: string): void {
    const row = this.rows.get(this.k(projectId, kind, itemId));
    if (row) {
      row.tombstoned_at = at;
      this.rows.set(this.k(projectId, kind, itemId), row);
    }
  }
}

// ---------------------------------------------------------------------------
// In-memory Confluence client stub — subclass of ConfluenceClient so the
// push service has a fully type-compatible instance, with the network methods
// overridden to use the in-memory store.
// ---------------------------------------------------------------------------

interface FakePage {
  id: string;
  title: string;
  version: number;
  spaceId: string;
  parentId?: string;
  adf: AdfDoc;
  status: "current" | "trashed";
}

class FakeClient extends ConfluenceClient {
  pages = new Map<string, FakePage>();
  nextId = 1;
  spaces = new Map<string, { id: string; key: string }>();
  ops: string[] = [];

  constructor(opts: { baseUrl?: string } = {}) {
    super({
      baseUrl: opts.baseUrl ?? "https://acme.atlassian.net",
      email: "bot@x",
      apiToken: "xxx",
    });
  }

  override async findSpace(key: string): Promise<{ id: string; key: string }> {
    const sp = this.spaces.get(key);
    if (!sp) throw new Error(`Confluence space not found: ${key}`);
    return sp;
  }

  override async createPage(input: {
    spaceId: string;
    title: string;
    parentId?: string;
    adfBody: AdfDoc;
  }): Promise<{ id: string; version: { number: number } }> {
    const id = `p${this.nextId++}`;
    const page: FakePage = {
      id,
      title: input.title,
      version: 1,
      spaceId: input.spaceId,
      parentId: input.parentId,
      adf: input.adfBody,
      status: "current",
    };
    this.pages.set(id, page);
    this.ops.push(`create:${id}:${input.title}:parent=${input.parentId ?? "none"}`);
    return { id, version: { number: 1 } };
  }

  override async updatePage(input: {
    id: string;
    version: number;
    title: string;
    adfBody: AdfDoc;
  }): Promise<{ id: string; version: { number: number } }> {
    const page = this.pages.get(input.id);
    if (!page) throw new Error(`Page not found: ${input.id}`);
    page.title = input.title;
    page.adf = input.adfBody;
    page.version = input.version + 1;
    this.ops.push(`update:${input.id}:v${page.version}`);
    return { id: input.id, version: { number: page.version } };
  }

  override async updatePageParent(input: {
    id: string;
    version: number;
    title: string;
    parentId: string | undefined;
  }): Promise<{ id: string; version: { number: number } }> {
    const page = this.pages.get(input.id);
    if (!page) throw new Error(`Page not found: ${input.id}`);
    page.title = input.title;
    page.parentId = input.parentId;
    page.version = input.version + 1;
    this.ops.push(`parent:${input.id}:parent=${input.parentId ?? "none"}`);
    return { id: input.id, version: { number: page.version } };
  }

  override async archivePage(id: string): Promise<void> {
    const page = this.pages.get(id);
    if (!page) throw new Error(`Page not found: ${id}`);
    page.status = "trashed";
    this.ops.push(`archive:${id}`);
  }
}

// ---------------------------------------------------------------------------
// Stub SpecRepository — only `snapshot` is exercised here. The `tree` field
// matters now (folder pages are created from it).
// ---------------------------------------------------------------------------

function makeSpec(items: Record<string, SpecItem>, tree: TreeNode[] = []): SpecRepository {
  const spec: Spec = {
    meta: {
      target: "demo",
      version: "v1",
      generatedAt: "2026-05-11T00:00:00Z",
    },
    tree,
    items: {},
  };
  return {
    async read() {
      return spec;
    },
    async write() {
      /* noop */
    },
    async readItem(id: string) {
      return items[id] ?? null;
    },
    async writeItem() {
      /* noop */
    },
    async deleteItem() {
      /* noop */
    },
    async listItemIds() {
      return Object.keys(items);
    },
    async snapshot() {
      return { spec, items };
    },
  };
}

function backendItem(id: string, title: string): SpecItem {
  return {
    id,
    type: "backend",
    title,
    method: "GET",
    route: `/${id}`,
    controller: "X",
    summary: "",
    context: "",
    parameters: [],
    responses: [],
    validationRules: [],
    orchestration: [],
    dependencies: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConfluencePushService", () => {
  it("first push creates a page per item + page-map row", async () => {
    const client = new FakeClient();
    client.spaces.set("DEMO", { id: "sp1", key: "DEMO" });
    const map = new MemoryPageMap();
    const repo = makeSpec({
      a: backendItem("a", "Item A"),
      b: backendItem("b", "Item B"),
    });

    const svc = new ConfluencePushService(client, map);
    const result = await svc.push(repo, {
      projectId: "proj1",
      spaceKey: "DEMO",
    });

    // Two creates in pass 1 + two updates in pass 2.
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);
    expect(result.archived).toBe(0);
    expect(map.listByProject("proj1")).toHaveLength(2);
    expect(client.pages.size).toBe(2);
    const allTitles = Array.from(client.pages.values()).map((p) => p.title);
    expect(allTitles.sort()).toEqual(["Item A", "Item B"]);
  });

  it("second push updates rather than re-creates", async () => {
    const client = new FakeClient();
    client.spaces.set("DEMO", { id: "sp1", key: "DEMO" });
    const map = new MemoryPageMap();
    const repo = makeSpec({ a: backendItem("a", "A") });
    const svc = new ConfluencePushService(client, map);

    const r1 = await svc.push(repo, { projectId: "p1", spaceKey: "DEMO" });
    expect(r1.created).toBe(1);

    const r2 = await svc.push(repo, { projectId: "p1", spaceKey: "DEMO" });
    expect(r2.created).toBe(0);
    expect(r2.updated).toBe(1);
    expect(r2.archived).toBe(0);
    // Page id should be stable across pushes.
    expect(client.pages.size).toBe(1);
  });

  it("removing an item from the spec archives the corresponding page", async () => {
    const client = new FakeClient();
    client.spaces.set("DEMO", { id: "sp1", key: "DEMO" });
    const map = new MemoryPageMap();
    const svc = new ConfluencePushService(client, map);

    // Push two, then push one.
    await svc.push(makeSpec({ a: backendItem("a", "A"), b: backendItem("b", "B") }), {
      projectId: "p1",
      spaceKey: "DEMO",
    });
    const r = await svc.push(makeSpec({ a: backendItem("a", "A") }), {
      projectId: "p1",
      spaceKey: "DEMO",
    });

    expect(r.archived).toBe(1);
    // The archived row should be tombstoned but still in the map.
    const rows = map.listByProject("p1");
    expect(rows).toHaveLength(2);
    const archived = rows.find((row) => row.item_id === "b" && row.kind === "item");
    expect(archived?.tombstoned_at).not.toBeNull();
    // Underlying page should be in trash.
    const page = client.pages.get(archived?.page_id ?? "");
    expect(page?.status).toBe("trashed");
  });

  it("cross-item link resolution: pass 1 stubs, pass 2 resolves", async () => {
    const client = new FakeClient();
    client.spaces.set("DEMO", { id: "sp1", key: "DEMO" });
    const map = new MemoryPageMap();

    const tiptap = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "see B",
              marks: [{ type: "link", attrs: { href: "#b" } }],
            },
          ],
        },
      ],
    });

    const items: Record<string, SpecItem> = {
      a: {
        ...backendItem("a", "A"),
        blocks: [{ id: "bl1", type: "richtext", content: tiptap }],
      } as unknown as SpecItem,
      b: backendItem("b", "B"),
    };
    const svc = new ConfluencePushService(client, map);
    await svc.push(makeSpec(items), { projectId: "p1", spaceKey: "DEMO" });

    const aRow = map.findByItem("p1", "item", "a");
    expect(aRow).toBeTruthy();
    const aPage = client.pages.get(aRow?.page_id ?? "");
    expect(aPage).toBeTruthy();
    const bRow = map.findByItem("p1", "item", "b");
    const expectedUrl = `https://acme.atlassian.net/wiki/spaces/DEMO/pages/${bRow?.page_id}`;
    const adfText = JSON.stringify(aPage?.adf);
    expect(adfText).toContain(expectedUrl);
  });

  it("creates ≥2 versions on each page after a full push (pass 1 create + pass 2 update)", async () => {
    const client = new FakeClient();
    client.spaces.set("DEMO", { id: "sp1", key: "DEMO" });
    const map = new MemoryPageMap();
    const svc = new ConfluencePushService(client, map);

    await svc.push(makeSpec({ a: backendItem("a", "A") }), {
      projectId: "p1",
      spaceKey: "DEMO",
    });

    // Pass 1 created v1, pass 2 PUT bumped to v2.
    const page = Array.from(client.pages.values())[0];
    expect(page?.version).toBe(2);
  });

  it("pushIterable yields per-page progress + final done event", async () => {
    const client = new FakeClient();
    client.spaces.set("DEMO", { id: "sp1", key: "DEMO" });
    const map = new MemoryPageMap();
    const svc = new ConfluencePushService(client, map);

    const events: Array<
      | { type: "progress"; message: string }
      | { type: "done"; result: { created: number; updated: number; archived: number } }
    > = [];
    for await (const ev of svc.pushIterable(
      makeSpec({ a: backendItem("a", "A"), b: backendItem("b", "B") }),
      { projectId: "p1", spaceKey: "DEMO" },
    )) {
      events.push(ev);
    }

    // Terminal event is `done` with totals.
    const last = events[events.length - 1];
    expect(last?.type).toBe("done");
    if (last?.type === "done") {
      expect(last.result).toEqual({ created: 2, updated: 0, archived: 0 });
    }

    // Per-page progress messages must include a 1-indexed counter so the UI
    // can render monotonic progress without extra bookkeeping. With 2 items
    // we expect at least "1/2" and "2/2" in the pass-1 messages.
    const progressMessages = events
      .filter((e): e is { type: "progress"; message: string } => e.type === "progress")
      .map((e) => e.message);
    expect(progressMessages.some((m) => /1\/2/.test(m))).toBe(true);
    expect(progressMessages.some((m) => /2\/2/.test(m))).toBe(true);

    // The plan summary line should mention both passes.
    expect(progressMessages.some((m) => /Plan:/.test(m))).toBe(true);
  });

  it("reuses tombstoned row by creating a fresh page when the item returns", async () => {
    const client = new FakeClient();
    client.spaces.set("DEMO", { id: "sp1", key: "DEMO" });
    const map = new MemoryPageMap();
    const svc = new ConfluencePushService(client, map);

    await svc.push(makeSpec({ a: backendItem("a", "A") }), {
      projectId: "p1",
      spaceKey: "DEMO",
    });
    // Archive A by pushing an empty spec.
    await svc.push(makeSpec({}), { projectId: "p1", spaceKey: "DEMO" });
    const row = map.findByItem("p1", "item", "a");
    expect(row?.tombstoned_at).toBeTruthy();
    // Push A back — should create a fresh page (existing row is tombstoned).
    const r = await svc.push(makeSpec({ a: backendItem("a", "A") }), {
      projectId: "p1",
      spaceKey: "DEMO",
    });
    expect(r.created).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Tree-aware push
  // -------------------------------------------------------------------------

  it("creates folder pages top-down and parents items under their folder", async () => {
    const client = new FakeClient();
    client.spaces.set("DEMO", { id: "sp1", key: "DEMO" });
    const map = new MemoryPageMap();

    // Tree shape:
    //   top/
    //     sub/
    //       a
    //     b
    //   c (root-level item)
    const tree: TreeNode[] = [
      {
        id: "top",
        type: "folder",
        label: "Top",
        children: [
          {
            id: "sub",
            type: "folder",
            label: "Sub",
            children: [{ id: "a", type: "backend" }],
          },
          { id: "b", type: "backend" },
        ],
      },
      { id: "c", type: "backend" },
    ];
    const items: Record<string, SpecItem> = {
      a: backendItem("a", "A"),
      b: backendItem("b", "B"),
      c: backendItem("c", "C"),
    };

    const svc = new ConfluencePushService(client, map);
    await svc.push(makeSpec(items, tree), {
      projectId: "p1",
      spaceKey: "DEMO",
      parentPageId: "ROOT",
    });

    // Pass A creates Top first, then Sub (BFS — parents always precede
    // their children). Then pass 1 creates items.
    const folderRows = map
      .listByProject("p1")
      .filter((r) => r.kind === "folder")
      .sort((x, y) => x.item_id.localeCompare(y.item_id));
    expect(folderRows.map((f) => f.item_id).sort()).toEqual(["sub", "top"]);

    const topRow = map.findByItem("p1", "folder", "top");
    const subRow = map.findByItem("p1", "folder", "sub");
    expect(topRow?.parent_page_id).toBe("ROOT");
    expect(subRow?.parent_page_id).toBe(topRow?.page_id);

    // Item A lives under sub → its create should target sub's page id.
    const aRow = map.findByItem("p1", "item", "a");
    expect(aRow?.parent_page_id).toBe(subRow?.page_id);
    // Item B lives under top.
    const bRow = map.findByItem("p1", "item", "b");
    expect(bRow?.parent_page_id).toBe(topRow?.page_id);
    // Item C lives at the tree root — fall back to cfg.parentPageId.
    const cRow = map.findByItem("p1", "item", "c");
    expect(cRow?.parent_page_id).toBe("ROOT");

    // Sanity check: create ops show parents threaded through correctly.
    const creates = client.ops.filter((o) => o.startsWith("create:"));
    // Six creates: 2 folders + 3 items + the items get a pass 2 update only.
    expect(creates).toHaveLength(5);
  });

  it("moving an item between folders issues a parent update on the next push", async () => {
    const client = new FakeClient();
    client.spaces.set("DEMO", { id: "sp1", key: "DEMO" });
    const map = new MemoryPageMap();

    // First push: a lives under folder "f1".
    const tree1: TreeNode[] = [
      {
        id: "f1",
        type: "folder",
        label: "F1",
        children: [{ id: "a", type: "backend" }],
      },
      { id: "f2", type: "folder", label: "F2", children: [] },
    ];
    const items: Record<string, SpecItem> = { a: backendItem("a", "A") };
    const svc = new ConfluencePushService(client, map);
    await svc.push(makeSpec(items, tree1), {
      projectId: "p1",
      spaceKey: "DEMO",
      parentPageId: "ROOT",
    });

    const f1Row = map.findByItem("p1", "folder", "f1");
    const aRow1 = map.findByItem("p1", "item", "a");
    expect(aRow1?.parent_page_id).toBe(f1Row?.page_id);

    // Second push: move a from f1 → f2.
    const tree2: TreeNode[] = [
      { id: "f1", type: "folder", label: "F1", children: [] },
      {
        id: "f2",
        type: "folder",
        label: "F2",
        children: [{ id: "a", type: "backend" }],
      },
    ];
    client.ops = []; // reset op log so we can assert only the second push.
    await svc.push(makeSpec(items, tree2), {
      projectId: "p1",
      spaceKey: "DEMO",
      parentPageId: "ROOT",
    });

    const f2Row = map.findByItem("p1", "folder", "f2");
    const aRow2 = map.findByItem("p1", "item", "a");
    expect(aRow2?.parent_page_id).toBe(f2Row?.page_id);

    // We expect a `parent:` op (the v2 PUT to re-parent the page) for the
    // moved item.
    const parentOps = client.ops.filter((o) => o.startsWith("parent:"));
    expect(parentOps.some((o) => o.includes(`parent=${f2Row?.page_id}`))).toBe(true);
  });

  it("removing a folder from the tree archives its folder page", async () => {
    const client = new FakeClient();
    client.spaces.set("DEMO", { id: "sp1", key: "DEMO" });
    const map = new MemoryPageMap();

    const tree1: TreeNode[] = [{ id: "doomed", type: "folder", label: "Doomed", children: [] }];
    const svc = new ConfluencePushService(client, map);
    await svc.push(makeSpec({}, tree1), { projectId: "p1", spaceKey: "DEMO" });
    const folderRow = map.findByItem("p1", "folder", "doomed");
    expect(folderRow?.tombstoned_at).toBeNull();

    // Push again without the folder — the folder page should be archived.
    const r = await svc.push(makeSpec({}, []), {
      projectId: "p1",
      spaceKey: "DEMO",
    });
    expect(r.archived).toBe(1);
    const after = map.findByItem("p1", "folder", "doomed");
    expect(after?.tombstoned_at).toBeTruthy();
    const page = client.pages.get(after?.page_id ?? "");
    expect(page?.status).toBe("trashed");
  });
});
