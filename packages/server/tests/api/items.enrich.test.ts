import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type GeneratorPlugin,
  GeneratorRegistry,
  ParserRegistry,
  emptyRunSummary,
} from "@specgen/core";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/api/app.js";
import { migrate } from "../../src/db/migrate.js";
import { openDb } from "../../src/db/sqlite.js";
import { SqliteProjectRepository } from "../../src/repositories/SqliteProjectRepository.js";
import { SqliteRunRepository } from "../../src/repositories/SqliteRunRepository.js";
import { RunEventBroker } from "../../src/services/RunEventBroker.js";
import { RunWorker } from "../../src/services/RunWorker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(__dirname, "../../src/db/migrations");
const PACKAGED_PROFILES = path.resolve(__dirname, "../../../core/profiles");

/**
 * Minimal generator that just yields `done` immediately. We register it under
 * the id `enrich-items` for these tests so we can spy on the enqueued options
 * without exercising the real AI enrichment loop.
 */
const fastEnrichmentGen: GeneratorPlugin = {
  id: "enrich-items",
  name: "Enrich items (fake)",
  description: "test stub",
  supports_profiles: "*",
  supports_parsers: "*",
  produces_item_types: [],
  async *run() {
    yield { type: "done", stats: emptyRunSummary() };
  },
};

const MINIMAL_SPEC = {
  meta: { target: "test", version: "v1", generatedAt: new Date().toISOString() },
  tree: [{ id: "item-a", type: "backend" }],
  items: { "item-a": { id: "item-a", type: "backend", title: "Test item" } },
};

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

interface Setup {
  app: import("express").Express;
  projects: SqliteProjectRepository;
  runs: SqliteRunRepository;
  worker: RunWorker;
  localPath: string;
}

function setup(): Setup {
  const dir = mkdtempSync(path.join(tmpdir(), "specgen-items-api-"));
  const db = openDb(path.join(dir, "test.db"));
  migrate(db, MIGRATIONS);
  const projects = new SqliteProjectRepository(db);
  const runs = new SqliteRunRepository(db);
  const broker = new RunEventBroker(path.join(dir, "logs"));

  const parserRegistry = new ParserRegistry();
  const generatorRegistry = new GeneratorRegistry();
  generatorRegistry.register(fastEnrichmentGen);

  const worker = new RunWorker({
    projects,
    runs,
    broker,
    packagedProfilesDir: PACKAGED_PROFILES,
    parserRegistry,
    generatorRegistry,
  });

  const app = buildApp({
    projects,
    runs,
    worker,
    broker,
    packagedProfilesDir: PACKAGED_PROFILES,
  });

  // Pre-populate a local project root with a minimal spec containing item-a.
  const localPath = mkdtempSync(path.join(tmpdir(), "specgen-local-"));
  const dataDir = path.join(localPath, ".specgen", "data");
  const itemsDir = path.join(dataDir, "items");
  mkdirSync(itemsDir, { recursive: true });
  writeFileSync(path.join(dataDir, "spec.json"), JSON.stringify(MINIMAL_SPEC, null, 2));
  writeFileSync(path.join(itemsDir, "item-a.json"), JSON.stringify(MINIMAL_ITEM, null, 2));

  projects.create({
    name: "Items Test",
    slug: "items-test",
    source: { type: "local", localPath },
    ai: { provider: "local", profileId: "pm-spec" },
  });

  return { app, projects, runs, worker, localPath };
}

describe("POST /api/v0/projects/:slug/items/:itemId/enrich", () => {
  it("enqueues an enrich-items run scoped to the target item and returns 202 with runId", async () => {
    const { app, worker, runs } = setup();
    const spy = vi.spyOn(worker, "enqueue");

    const res = await request(app).post("/api/v0/projects/items-test/items/item-a/enrich").send({});

    expect(res.status).toBe(202);
    expect(res.body.runId).toMatch(/^01[0-9A-HJKMNP-TV-Z]{24}$/);

    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0][0];
    // Route uses `enrich-items` (not enrichment-pipeline) so re-enriching a
    // single item never triggers a destructive re-parse + smart-tree shuffle.
    expect(call.generatorId).toBe("enrich-items");
    expect(call.options).toMatchObject({
      itemIds: ["item-a"],
      force: true,
    });

    // The persisted run row should agree on generatorId; options aren't
    // persisted to the DB (in-memory only), so we don't assert on those here.
    const row = runs.findById(res.body.runId);
    expect(row?.generator_id).toBe("enrich-items");
  });

  it("returns 404 when the project does not exist", async () => {
    const { app } = setup();
    const res = await request(app)
      .post("/api/v0/projects/no-such-project/items/item-a/enrich")
      .send({});
    expect(res.status).toBe(404);
  });

  it("returns 404 when the item does not exist within a known project", async () => {
    const { app } = setup();
    const res = await request(app)
      .post("/api/v0/projects/items-test/items/no-such-item/enrich")
      .send({});
    expect(res.status).toBe(404);
  });

  it("returns 400 for an invalid slug shape (e.g. contains a space)", async () => {
    const { app } = setup();
    const res = await request(app).post("/api/v0/projects/foo%20bar/items/item-a/enrich").send({});
    expect(res.status).toBe(400);
  });
});
