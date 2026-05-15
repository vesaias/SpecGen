import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonSpecRepository } from "../../src/spec/JsonSpecRepository.js";
import type { Spec, SpecItem } from "../../src/spec/types.js";

function makeTempDir() {
  return mkdtempSync(path.join(tmpdir(), "specgen-repo-test-"));
}

function makeSpec(overrides?: Partial<Spec>): Spec {
  return {
    meta: {
      target: "test-project",
      version: "v2026.05.09",
      generatedAt: "2026-05-09T00:00:00.000Z",
    },
    tree: [{ id: "backend", type: "folder", label: "Backend", children: [] }],
    items: {},
    ...overrides,
  };
}

function makeItem(id: string, overrides?: Partial<SpecItem>): SpecItem {
  return {
    id,
    type: "backend",
    title: `Item ${id}`,
    method: "GET",
    route: "/api/test",
    controller: "TestController",
    summary: "",
    context: "",
    parameters: [],
    responses: [],
    validationRules: [],
    orchestration: [],
    dependencies: [],
    ...overrides,
  } as SpecItem;
}

describe("JsonSpecRepository", () => {
  it("read() returns null on empty dir", async () => {
    const repo = new JsonSpecRepository(makeTempDir());
    const result = await repo.read();
    expect(result).toBeNull();
  });

  it("write() then read() round-trips the spec", async () => {
    const repo = new JsonSpecRepository(makeTempDir());
    const spec = makeSpec();
    await repo.write(spec);
    const read = await repo.read();
    expect(read).toEqual(spec);
  });

  it("writeItem() then readItem() round-trips", async () => {
    const repo = new JsonSpecRepository(makeTempDir());
    const item = makeItem("get-api-orders");
    await repo.writeItem(item);
    const read = await repo.readItem("get-api-orders");
    expect(read).toEqual(item);
  });

  it("readItem() returns null for unknown id", async () => {
    const repo = new JsonSpecRepository(makeTempDir());
    const result = await repo.readItem("unknown-id");
    expect(result).toBeNull();
  });

  it("listItemIds() returns sorted ids", async () => {
    const repo = new JsonSpecRepository(makeTempDir());
    await repo.writeItem(makeItem("page-dashboard"));
    await repo.writeItem(makeItem("get-api-orders"));
    await repo.writeItem(makeItem("event-order-created"));
    const ids = await repo.listItemIds();
    expect(ids).toEqual(["event-order-created", "get-api-orders", "page-dashboard"]);
  });

  it("listItemIds() returns empty array when no items dir exists", async () => {
    const repo = new JsonSpecRepository(makeTempDir());
    const ids = await repo.listItemIds();
    expect(ids).toEqual([]);
  });

  it("deleteItem() removes the item file", async () => {
    const repo = new JsonSpecRepository(makeTempDir());
    await repo.writeItem(makeItem("get-api-orders"));
    await repo.deleteItem("get-api-orders");
    const result = await repo.readItem("get-api-orders");
    expect(result).toBeNull();
  });

  it("deleteItem() is a no-op for non-existent item", async () => {
    const repo = new JsonSpecRepository(makeTempDir());
    // Should not throw
    await expect(repo.deleteItem("non-existent")).resolves.toBeUndefined();
  });

  it("writeItem() then write() — spec round-trips include meta and tree", async () => {
    const repo = new JsonSpecRepository(makeTempDir());
    const item = makeItem("get-api-orders");
    const spec = makeSpec({
      items: { "get-api-orders": item },
      tree: [
        {
          id: "backend",
          type: "folder",
          label: "Backend",
          children: [{ id: "get-api-orders", type: "backend" }],
        },
      ],
    });
    await repo.write(spec);
    const read = await repo.read();
    expect(read?.meta.target).toBe("test-project");
    expect(read?.tree).toHaveLength(1);
    expect(Object.keys(read?.items ?? {})).toEqual(["get-api-orders"]);
  });

  // ---------------------------------------------------------------------------
  // Path traversal protection
  // ---------------------------------------------------------------------------

  it("rejects id with path traversal (.. segments)", async () => {
    const repo = new JsonSpecRepository(makeTempDir());
    await expect(repo.readItem("../etc/passwd")).rejects.toThrow(/Invalid item id/);
    await expect(repo.writeItem(makeItem("../evil"))).rejects.toThrow(/Invalid item id/);
    await expect(repo.deleteItem("../../root")).rejects.toThrow(/Invalid item id/);
  });

  it("rejects id with uppercase letters", async () => {
    const repo = new JsonSpecRepository(makeTempDir());
    await expect(repo.readItem("MyItem")).rejects.toThrow(/Invalid item id/);
  });

  it("rejects id with slashes", async () => {
    const repo = new JsonSpecRepository(makeTempDir());
    await expect(repo.readItem("folder/item")).rejects.toThrow(/Invalid item id/);
  });

  it("accepts valid ids like 'get-api-orders', 'page-dashboard', 'event-order-created'", async () => {
    const repo = new JsonSpecRepository(makeTempDir());
    const validIds = ["get-api-orders", "page-dashboard", "event-order-created", "a1", "abc123"];
    for (const id of validIds) {
      await expect(repo.readItem(id)).resolves.toBeNull(); // no error
    }
  });

  // ---------------------------------------------------------------------------
  // snapshot()
  // ---------------------------------------------------------------------------

  describe("snapshot()", () => {
    it("reads spec + every item file", async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "snap-"));
      const repo = new JsonSpecRepository(dir);
      await repo.write({
        meta: { target: "t", version: "v", generatedAt: "2026-01-01" },
        tree: [],
        items: { a: { id: "a", type: "backend", title: "A" } as SpecItem },
      });
      await repo.writeItem({ id: "a", type: "backend", title: "A" } as SpecItem);
      await repo.writeItem({ id: "b", type: "backend", title: "B" } as SpecItem);

      const snap = await repo.snapshot();
      expect(Object.keys(snap.items).sort()).toEqual(["a", "b"]);
      expect(snap.spec.meta.target).toBe("t");
      expect(snap.spec.tree).toEqual([]);
    });

    it("tolerates items missing from disk after listItemIds() returns", async () => {
      // Drop an extra file in items/ but with malformed content; listItemIds
      // will see it, readItem returns null, snapshot should skip silently.
      const dir = mkdtempSync(path.join(tmpdir(), "snap2-"));
      const repo = new JsonSpecRepository(dir);
      await repo.write({
        meta: { target: "t", version: "v", generatedAt: "2026-01-01" },
        tree: [],
        items: {},
      });
      await repo.writeItem({ id: "good", type: "backend", title: "G" } as SpecItem);
      // Write a malformed JSON file directly — readItem returns null on parse error.
      writeFileSync(path.join(dir, "items", "broken.json"), "not-json", "utf8");
      const snap = await repo.snapshot();
      expect(Object.keys(snap.items)).toEqual(["good"]); // broken is silently skipped
    });

    it("throws if spec.json is missing", async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "snap3-"));
      const repo = new JsonSpecRepository(dir);
      await expect(repo.snapshot()).rejects.toThrow();
    });

    it("returns empty items map when no item files exist yet", async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "snap4-"));
      const repo = new JsonSpecRepository(dir);
      await repo.write({
        meta: { target: "t", version: "v", generatedAt: "2026-01-01" },
        tree: [],
        items: {},
      });
      const snap = await repo.snapshot();
      expect(snap.items).toEqual({});
      expect(snap.spec.meta.target).toBe("t");
      expect(snap.spec.tree).toEqual([]);
    });

    it("snapshot prunes tree of items that don't exist on disk", async () => {
      const dir = mkdtempSync(path.join(tmpdir(), "snap-prune-"));
      const repo = new JsonSpecRepository(dir);
      await repo.write({
        meta: { target: "t", version: "v", generatedAt: "2026-01-01" },
        tree: [
          {
            id: "backend",
            type: "folder",
            label: "Backend",
            children: [
              { id: "alive", type: "backend" as const },
              { id: "ghost", type: "backend" as const },
            ],
          },
        ],
        items: {} as any,
      });
      await repo.writeItem({ id: "alive", type: "backend", title: "A" } as SpecItem);
      // "ghost" is referenced in tree but no item file on disk
      const snap = await repo.snapshot();
      expect(snap.spec.tree).toEqual([
        {
          id: "backend",
          type: "folder",
          label: "Backend",
          children: [{ id: "alive", type: "backend" }],
        },
      ]);
    });
  });
});
