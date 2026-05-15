import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/api/app.js";
import { migrate } from "../../src/db/migrate.js";
import { openDb } from "../../src/db/sqlite.js";
import { SqliteProjectRepository } from "../../src/repositories/SqliteProjectRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");
const PACKAGED_PROFILES = path.resolve(__dirname, "../../../core/profiles");

/** Minimal spec.json for a project */
const MINIMAL_SPEC = {
  meta: { target: "test", version: "v1", generatedAt: new Date().toISOString() },
  tree: [{ id: "item-a", type: "backend" }],
  items: { "item-a": { id: "item-a", type: "backend", title: "Test item" } },
};

/** Minimal item file as written by the CLI (superset of SpecItem) */
const MINIMAL_ITEM: Record<string, unknown> = {
  id: "item-a",
  type: "backend",
  title: "Test item",
  blocks: [{ id: "b-1", type: "richtext", content: "Hello" }],
  version: 1,
  lastModified: new Date().toISOString(),
  modifiedBy: "cli",
  versions: [],
};

function buildTestApp() {
  const dir = mkdtempSync(path.join(tmpdir(), "specgen-spec-routes-"));
  const db = openDb(path.join(dir, "test.db"));
  migrate(db, MIGRATIONS_DIR);
  const projects = new SqliteProjectRepository(db);
  const app = buildApp({ projects, packagedProfilesDir: PACKAGED_PROFILES });
  return { app, db, dir, projects };
}

/** Create a project pointing at a temp local dir that already has spec data. */
function setupProjectWithSpec(app: ReturnType<typeof buildApp>, projects: SqliteProjectRepository) {
  // Create a local path with pre-populated spec data
  const localPath = mkdtempSync(path.join(tmpdir(), "specgen-local-"));
  const dataDir = path.join(localPath, ".specgen", "data");
  const itemsDir = path.join(dataDir, "items");
  mkdirSync(itemsDir, { recursive: true });
  writeFileSync(path.join(dataDir, "spec.json"), JSON.stringify(MINIMAL_SPEC, null, 2));
  writeFileSync(path.join(itemsDir, "item-a.json"), JSON.stringify(MINIMAL_ITEM, null, 2));

  const project = projects.create({
    name: "Spec Test Project",
    slug: "spec-test",
    source: { type: "local", localPath },
  });

  return { project, localPath };
}

describe("GET /api/projects/:slug/spec", () => {
  it("returns spec with items when spec.json exists", async () => {
    const { app, projects } = buildTestApp();
    setupProjectWithSpec(app, projects);

    const res = await request(app).get("/api/projects/spec-test/spec");
    expect(res.status).toBe(200);
    expect(res.body.meta.target).toBe("test");
    expect(res.body.items["item-a"]).toBeDefined();
    expect(res.body.items["item-a"].title).toBe("Test item");
  });

  it("returns 404 when no spec.json exists", async () => {
    const { app, projects } = buildTestApp();
    // Project with no spec data
    const emptyPath = mkdtempSync(path.join(tmpdir(), "specgen-empty-"));
    projects.create({
      name: "Empty Project",
      slug: "empty-proj",
      source: { type: "local", localPath: emptyPath },
    });

    const res = await request(app).get("/api/projects/empty-proj/spec");
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown project slug", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/projects/no-such-proj/spec");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/projects/:slug/spec/item/:id", () => {
  it("returns the item file", async () => {
    const { app, projects } = buildTestApp();
    setupProjectWithSpec(app, projects);

    const res = await request(app).get("/api/projects/spec-test/spec/item/item-a");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("item-a");
    expect(res.body.blocks).toHaveLength(1);
  });

  it("returns 404 for unknown item id", async () => {
    const { app, projects } = buildTestApp();
    setupProjectWithSpec(app, projects);

    const res = await request(app).get("/api/projects/spec-test/spec/item/no-such-item");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/projects/:slug/spec/item/:id", () => {
  it("updates blocks and bumps version", async () => {
    const { app, projects } = buildTestApp();
    setupProjectWithSpec(app, projects);

    const newBlocks = [{ id: "b-2", type: "richtext", content: "Updated" }];
    const res = await request(app)
      .patch("/api/projects/spec-test/spec/item/item-a")
      .send({ blocks: newBlocks });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe(2);

    // Verify the item was updated
    const getRes = await request(app).get("/api/projects/spec-test/spec/item/item-a");
    expect(getRes.body.blocks[0].content).toBe("Updated");
  });

  it("pushes a version snapshot before applying changes", async () => {
    const { app, projects } = buildTestApp();
    setupProjectWithSpec(app, projects);

    await request(app)
      .patch("/api/projects/spec-test/spec/item/item-a")
      .send({ blocks: [{ id: "b-2", type: "richtext", content: "v2" }] });

    const versRes = await request(app).get("/api/projects/spec-test/spec/item/item-a/versions");
    expect(versRes.status).toBe(200);
    // Should have current (v2) + the saved snapshot (v1)
    expect(versRes.body.length).toBeGreaterThanOrEqual(2);
    expect(versRes.body[0].version).toBe(2); // current is first
    expect(versRes.body[1].version).toBe(1); // previous snapshot
  });
});

describe("GET /api/projects/:slug/spec/item/:id/versions", () => {
  it("lists version history with current prepended", async () => {
    const { app, projects } = buildTestApp();
    setupProjectWithSpec(app, projects);

    const res = await request(app).get("/api/projects/spec-test/spec/item/item-a/versions");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // At minimum the current version entry should exist
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].changes).toBe("current");
  });
});

describe("GET /api/projects/:slug/spec/item/:id/version/:v", () => {
  it("returns blocks for current version", async () => {
    const { app, projects } = buildTestApp();
    setupProjectWithSpec(app, projects);

    const res = await request(app).get("/api/projects/spec-test/spec/item/item-a/version/1");
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(Array.isArray(res.body.blocks)).toBe(true);
  });

  it("returns 404 for non-existent version", async () => {
    const { app, projects } = buildTestApp();
    setupProjectWithSpec(app, projects);

    const res = await request(app).get("/api/projects/spec-test/spec/item/item-a/version/99");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects/:slug/spec/item/:id/restore/:v", () => {
  it("restores a previous version and bumps version number", async () => {
    const { app, projects } = buildTestApp();
    setupProjectWithSpec(app, projects);

    // First PATCH to create a history
    await request(app)
      .patch("/api/projects/spec-test/spec/item/item-a")
      .send({ blocks: [{ id: "b-99", type: "richtext", content: "Second version" }] });

    // Now restore version 1
    const restoreRes = await request(app).post(
      "/api/projects/spec-test/spec/item/item-a/restore/1",
    );
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.ok).toBe(true);
    expect(restoreRes.body.version).toBe(3);

    // Blocks should be back to original
    const getRes = await request(app).get("/api/projects/spec-test/spec/item/item-a");
    expect(getRes.body.blocks[0].content).toBe("Hello");
  });

  it("returns 404 for non-existent version to restore", async () => {
    const { app, projects } = buildTestApp();
    setupProjectWithSpec(app, projects);

    const res = await request(app).post("/api/projects/spec-test/spec/item/item-a/restore/99");
    expect(res.status).toBe(404);
  });
});
