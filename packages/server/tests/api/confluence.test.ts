import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GeneratorRegistry, ParserRegistry, confluencePushGenerator } from "@specgen/core";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/api/app.js";
import { migrate } from "../../src/db/migrate.js";
import { openDb } from "../../src/db/sqlite.js";
import { ConfluencePageMapRepository } from "../../src/repositories/ConfluencePageMapRepository.js";
import { SqliteProjectRepository } from "../../src/repositories/SqliteProjectRepository.js";
import { SqliteRunRepository } from "../../src/repositories/SqliteRunRepository.js";
import { RunEventBroker } from "../../src/services/RunEventBroker.js";
import { RunWorker } from "../../src/services/RunWorker.js";
import { TokenStore } from "../../src/services/TokenStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");
const PACKAGED_PROFILES = path.resolve(__dirname, "../../../core/profiles");

// ---------------------------------------------------------------------------
// Mock @specgen/connector-confluence so the REST tests don't hit the network.
// - ConfluenceClient.findSpace resolves to a stable space record.
// - ConfluencePushService.pushIterable yields a single done event with canned
//   totals (the route only consumes the service via the generator).
// ---------------------------------------------------------------------------

let nextFindSpaceRejects = false;

vi.mock("@specgen/connector-confluence", async (importOriginal) => {
  const original = await importOriginal<typeof import("@specgen/connector-confluence")>();
  return {
    ...original,
    ConfluenceClient: class FakeClient {
      baseUrl = "https://acme.atlassian.net";
      async findSpace(key: string): Promise<{ id: string; key: string }> {
        if (nextFindSpaceRejects) throw new Error("forced findSpace failure");
        return { id: "sp1", key };
      }
    },
    ConfluencePushService: class FakePushService {
      async push(): Promise<{ created: number; updated: number; archived: number }> {
        return { created: 2, updated: 0, archived: 0 };
      }
      async *pushIterable(): AsyncGenerator<
        | { type: "progress"; message: string }
        | { type: "done"; result: { created: number; updated: number; archived: number } }
      > {
        yield { type: "progress", message: "fake — connecting" };
        yield { type: "done", result: { created: 2, updated: 0, archived: 0 } };
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

function buildTestApp() {
  const dir = mkdtempSync(path.join(tmpdir(), "specgen-confluence-api-"));
  const db = openDb(path.join(dir, "test.db"));
  migrate(db, MIGRATIONS_DIR);
  const projects = new SqliteProjectRepository(db);
  const runs = new SqliteRunRepository(db);
  const broker = new RunEventBroker(path.join(dir, "logs"));
  const confluencePageMap = new ConfluencePageMapRepository(db);
  const tokens = new TokenStore(db, Buffer.alloc(32, "k"));

  const parserRegistry = new ParserRegistry();
  const generatorRegistry = new GeneratorRegistry();
  generatorRegistry.register(confluencePushGenerator);

  const worker = new RunWorker({
    projects,
    runs,
    broker,
    packagedProfilesDir: PACKAGED_PROFILES,
    parserRegistry,
    generatorRegistry,
    tokens,
  });

  const app = buildApp({
    projects,
    runs,
    worker,
    broker,
    packagedProfilesDir: PACKAGED_PROFILES,
    tokens,
    confluencePageMap,
  });
  return { app, projects, tokens, confluencePageMap, runs, worker };
}

async function createConfluenceProject(
  app: ReturnType<typeof buildTestApp>["app"],
  projects: SqliteProjectRepository,
  tokens: TokenStore,
  opts: { withConfig?: boolean; withToken?: boolean } = {},
): Promise<string> {
  const { withConfig = true, withToken = true } = opts;
  const createRes = await request(app)
    .post("/api/projects")
    .send({
      name: "Confluence Test",
      source: { type: "local", localPath: tmpdir() },
    });
  expect(createRes.status).toBe(201);
  const { slug } = createRes.body as { slug: string };

  if (withConfig) {
    projects.update(slug, {
      connectors: { confluence: { spaceKey: "DEMO" } },
    });
  }

  const project = projects.findBySlug(slug);
  if (!project) throw new Error("project missing after update");

  if (withToken) {
    await tokens.set(
      { projectId: project.id, provider: "confluence" },
      {
        provider: "confluence",
        baseUrl: "https://acme.atlassian.net",
        email: "bot@x",
        apiToken: "tok",
      },
    );
  }

  return slug;
}

describe("Confluence REST router", () => {
  beforeEach(() => {
    nextFindSpaceRejects = false;
  });

  it("POST /confluence/test returns ok+space on success", async () => {
    const { app, projects, tokens } = buildTestApp();
    const slug = await createConfluenceProject(app, projects, tokens);
    const res = await request(app).post(`/api/v0/projects/${slug}/confluence/test`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.space).toEqual({ id: "sp1", key: "DEMO" });
  });

  it("POST /confluence/test returns 400 when connector is not configured", async () => {
    const { app, projects, tokens } = buildTestApp();
    const slug = await createConfluenceProject(app, projects, tokens, {
      withConfig: false,
    });
    const res = await request(app).post(`/api/v0/projects/${slug}/confluence/test`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it("POST /confluence/test returns 400 when token is missing", async () => {
    const { app, projects, tokens } = buildTestApp();
    const slug = await createConfluenceProject(app, projects, tokens, {
      withToken: false,
    });
    const res = await request(app).post(`/api/v0/projects/${slug}/confluence/test`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token required/i);
  });

  it("POST /confluence/test surfaces space-not-found as 400", async () => {
    const { app, projects, tokens } = buildTestApp();
    const slug = await createConfluenceProject(app, projects, tokens);
    nextFindSpaceRejects = true;
    const res = await request(app).post(`/api/v0/projects/${slug}/confluence/test`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/forced findSpace failure/);
  });

  it("POST /confluence/push enqueues a streaming run and returns 202 with runId", async () => {
    const { app, projects, tokens, worker } = buildTestApp();
    const slug = await createConfluenceProject(app, projects, tokens);
    const spy = vi.spyOn(worker, "enqueue");

    const res = await request(app).post(`/api/v0/projects/${slug}/confluence/push`);
    expect(res.status).toBe(202);
    expect(res.body.runId).toMatch(/^01[0-9A-HJKMNP-TV-Z]{24}$/);
    expect(res.body.status).toBe("queued");

    // The route should have built a ConfluencePushService and stuffed it into
    // options alongside the projectId + spaceKey. We can't deep-equal the
    // service instance, so check the structural shape.
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0][0];
    expect(call.generatorId).toBe("confluence-push");
    expect(call.options).toMatchObject({ spaceKey: "DEMO" });
    expect(typeof (call.options as { confluencePushService?: unknown }).confluencePushService).toBe(
      "object",
    );
  });

  it("POST /confluence/push returns 400 without configured spaceKey", async () => {
    const { app, projects, tokens } = buildTestApp();
    const slug = await createConfluenceProject(app, projects, tokens, {
      withConfig: false,
    });
    const res = await request(app).post(`/api/v0/projects/${slug}/confluence/push`);
    expect(res.status).toBe(400);
  });

  it("POST /confluence/push returns 400 when token is missing", async () => {
    const { app, projects, tokens } = buildTestApp();
    const slug = await createConfluenceProject(app, projects, tokens, {
      withToken: false,
    });
    const res = await request(app).post(`/api/v0/projects/${slug}/confluence/push`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/token required/i);
  });

  it("GET /confluence/state returns empty state for a fresh project", async () => {
    const { app, projects, tokens } = buildTestApp();
    const slug = await createConfluenceProject(app, projects, tokens);
    const res = await request(app).get(`/api/v0/projects/${slug}/confluence/state`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      live: 0,
      tombstoned: 0,
      lastSyncedAt: null,
      pages: [],
    });
  });

  it("GET /confluence/state reflects page-map rows", async () => {
    const { app, projects, tokens, confluencePageMap } = buildTestApp();
    const slug = await createConfluenceProject(app, projects, tokens);
    const project = projects.findBySlug(slug);
    if (!project) throw new Error("missing project");

    confluencePageMap.upsert({
      project_id: project.id,
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
    });
    confluencePageMap.upsert({
      project_id: project.id,
      kind: "item",
      item_id: "b",
      space_id: "sp1",
      page_id: "page2",
      page_version: 1,
      parent_page_id: null,
      remote_title: "B",
      content_hash: null,
      tombstoned_at: "2026-05-12T00:00:00Z",
      last_synced_at: "2026-05-12T00:00:00Z",
    });

    const res = await request(app).get(`/api/v0/projects/${slug}/confluence/state`);
    expect(res.status).toBe(200);
    expect(res.body.live).toBe(1);
    expect(res.body.tombstoned).toBe(1);
    expect(res.body.lastSyncedAt).toBe("2026-05-12T00:00:00Z");
  });

  it("returns 404 for a missing project", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/v0/projects/nope/confluence/test");
    expect(res.status).toBe(404);
  });
});
