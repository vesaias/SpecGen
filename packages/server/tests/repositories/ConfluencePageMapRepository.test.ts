import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import { openDb } from "../../src/db/sqlite.js";
import {
  type ConfluencePageMap,
  ConfluencePageMapRepository,
} from "../../src/repositories/ConfluencePageMapRepository.js";
import { SqliteProjectRepository } from "../../src/repositories/SqliteProjectRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(__dirname, "../../src/db/migrations");

function setup(): {
  repo: ConfluencePageMapRepository;
  projectId: string;
} {
  const dbDir = mkdtempSync(path.join(tmpdir(), "specgen-cmap-"));
  const db = openDb(path.join(dbDir, "test.db"));
  migrate(db, MIGRATIONS);
  const projects = new SqliteProjectRepository(db);
  const project = projects.create({
    name: "Test",
    source: { type: "local", localPath: "/tmp/test" },
  });
  return { repo: new ConfluencePageMapRepository(db), projectId: project.id };
}

function row(over: Partial<ConfluencePageMap> = {}): ConfluencePageMap {
  return {
    project_id: "p1",
    kind: "item",
    item_id: "a",
    space_id: "sp1",
    page_id: "page1",
    page_version: 1,
    parent_page_id: null,
    remote_title: "A",
    content_hash: null,
    tombstoned_at: null,
    last_synced_at: "2026-05-11T00:00:00Z",
    ...over,
  };
}

describe("ConfluencePageMapRepository", () => {
  it("upsert + findByItem round-trip", () => {
    const { repo, projectId } = setup();
    repo.upsert(row({ project_id: projectId }));
    const got = repo.findByItem(projectId, "item", "a");
    expect(got).not.toBeNull();
    expect(got?.page_id).toBe("page1");
    expect(got?.page_version).toBe(1);
    expect(got?.kind).toBe("item");
  });

  it("findByItem returns null for missing rows", () => {
    const { repo, projectId } = setup();
    expect(repo.findByItem(projectId, "item", "missing")).toBeNull();
  });

  it("upsert on conflict updates rather than inserts", () => {
    const { repo, projectId } = setup();
    repo.upsert(row({ project_id: projectId }));
    repo.upsert(
      row({
        project_id: projectId,
        page_version: 5,
        remote_title: "A renamed",
      }),
    );
    const got = repo.findByItem(projectId, "item", "a");
    expect(got?.page_version).toBe(5);
    expect(got?.remote_title).toBe("A renamed");
    expect(repo.listByProject(projectId)).toHaveLength(1);
  });

  it("listByProject returns sorted rows for that project only", () => {
    const { repo, projectId } = setup();
    repo.upsert(row({ project_id: projectId, item_id: "b" }));
    repo.upsert(row({ project_id: projectId, item_id: "a" }));
    const rows = repo.listByProject(projectId);
    // Sorted by (kind, item_id) — same kind, so alphabetical by item_id.
    expect(rows.map((r) => r.item_id)).toEqual(["a", "b"]);
  });

  it("tombstone sets tombstoned_at without dropping the row", () => {
    const { repo, projectId } = setup();
    repo.upsert(row({ project_id: projectId }));
    repo.tombstone(projectId, "item", "a", "2026-05-12T00:00:00Z");
    const got = repo.findByItem(projectId, "item", "a");
    expect(got?.tombstoned_at).toBe("2026-05-12T00:00:00Z");
  });

  it("cascades on project delete (FK)", () => {
    const { repo, projectId } = setup();
    repo.upsert(row({ project_id: projectId }));
    expect(repo.findByItem(projectId, "item", "a")).not.toBeNull();
    const db = (repo as any).db;
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    expect(repo.findByItem(projectId, "item", "a")).toBeNull();
  });

  // -------------------------------------------------------------------------
  // kind-aware behaviour (tree-aware push)
  // -------------------------------------------------------------------------

  it("item and folder rows with the same id co-exist", () => {
    const { repo, projectId } = setup();
    // Edge case: tree folder id and item id happen to match. The composite
    // PK on (project, kind, item_id) keeps them distinct.
    repo.upsert(row({ project_id: projectId, kind: "item", item_id: "shared" }));
    repo.upsert(
      row({
        project_id: projectId,
        kind: "folder",
        item_id: "shared",
        page_id: "folder-page",
        parent_page_id: "root",
        remote_title: "Shared folder",
      }),
    );
    expect(repo.listByProject(projectId)).toHaveLength(2);
    const item = repo.findByItem(projectId, "item", "shared");
    const folder = repo.findByItem(projectId, "folder", "shared");
    expect(item?.page_id).toBe("page1");
    expect(folder?.page_id).toBe("folder-page");
    expect(folder?.parent_page_id).toBe("root");
  });

  it("tombstoning the item kind leaves the folder kind alone", () => {
    const { repo, projectId } = setup();
    repo.upsert(row({ project_id: projectId, kind: "item", item_id: "x" }));
    repo.upsert(row({ project_id: projectId, kind: "folder", item_id: "x" }));
    repo.tombstone(projectId, "item", "x", "2026-05-12T00:00:00Z");
    expect(repo.findByItem(projectId, "item", "x")?.tombstoned_at).toBe("2026-05-12T00:00:00Z");
    expect(repo.findByItem(projectId, "folder", "x")?.tombstoned_at).toBeNull();
  });

  it("upsert persists parent_page_id and updates it on conflict", () => {
    const { repo, projectId } = setup();
    repo.upsert(
      row({
        project_id: projectId,
        kind: "folder",
        item_id: "f1",
        parent_page_id: "p-old",
      }),
    );
    repo.upsert(
      row({
        project_id: projectId,
        kind: "folder",
        item_id: "f1",
        parent_page_id: "p-new",
        page_version: 2,
      }),
    );
    const got = repo.findByItem(projectId, "folder", "f1");
    expect(got?.parent_page_id).toBe("p-new");
    expect(got?.page_version).toBe(2);
  });
});
