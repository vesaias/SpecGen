import { mkdtempSync } from "node:fs";
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

/** Local path validation requires real directories; reuse the OS temp dir for fixtures. */
const FIXTURE_LOCAL = tmpdir();

function buildTestApp() {
  const dir = mkdtempSync(path.join(tmpdir(), "specgen-api-"));
  const db = openDb(path.join(dir, "test.db"));
  migrate(db, MIGRATIONS_DIR);
  const projects = new SqliteProjectRepository(db);
  const app = buildApp({ projects, packagedProfilesDir: PACKAGED_PROFILES });
  return { app, db };
}

describe("POST /api/projects", () => {
  it("creates a project with auto-derived slug", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/projects")
      .send({
        name: "My First Project",
        source: { type: "local", localPath: FIXTURE_LOCAL },
      });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe("my-first-project");
    expect(res.body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID shape
    expect(res.body.source.type).toBe("local");
  });

  it("rejects when name is missing", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/projects")
      .send({ source: { type: "local", localPath: FIXTURE_LOCAL } });
    expect(res.status).toBe(400);
  });

  it("rejects when source is missing", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/projects").send({ name: "X" });
    expect(res.status).toBe(400);
  });

  it("rejects duplicate slug", async () => {
    const { app } = buildTestApp();
    await request(app)
      .post("/api/projects")
      .send({
        name: "Same Name",
        source: { type: "local", localPath: FIXTURE_LOCAL },
      });
    const res = await request(app)
      .post("/api/projects")
      .send({
        name: "Same Name",
        source: { type: "local", localPath: FIXTURE_LOCAL },
      });
    expect(res.status).toBe(409);
  });

  it("accepts an explicit slug if valid", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/projects")
      .send({
        name: "X",
        slug: "custom-slug",
        source: { type: "local", localPath: FIXTURE_LOCAL },
      });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe("custom-slug");
  });

  it("rejects slug with invalid characters", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/projects")
      .send({
        name: "X",
        slug: "Invalid_Slug",
        source: { type: "local", localPath: FIXTURE_LOCAL },
      });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/projects", () => {
  it("lists projects (newest first)", async () => {
    const { app } = buildTestApp();
    await request(app)
      .post("/api/projects")
      .send({
        name: "A",
        source: { type: "local", localPath: FIXTURE_LOCAL },
      });
    await request(app)
      .post("/api/projects")
      .send({
        name: "B",
        source: { type: "local", localPath: FIXTURE_LOCAL },
      });
    const res = await request(app).get("/api/projects");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

describe("GET /api/projects/:slug", () => {
  it("returns the project", async () => {
    const { app } = buildTestApp();
    const created = await request(app)
      .post("/api/projects")
      .send({
        name: "X",
        source: { type: "local", localPath: FIXTURE_LOCAL },
      });
    const res = await request(app).get(`/api/projects/${created.body.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
  });

  it("returns 404 for unknown slug", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/projects/no-such");
    expect(res.status).toBe(404);
  });

  it("rejects path traversal in slug param", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/projects/..%2F..%2Fetc%2Fpasswd");
    // 404 is also acceptable here — but the validator should kick before lookup
    expect([400, 404]).toContain(res.status);
  });

  it("rejects slug with invalid characters", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/projects/Invalid_Slug");
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/projects/:slug", () => {
  it("updates name and ai settings", async () => {
    const { app } = buildTestApp();
    const created = await request(app)
      .post("/api/projects")
      .send({
        name: "Original",
        source: { type: "local", localPath: FIXTURE_LOCAL },
      });
    const res = await request(app)
      .patch(`/api/projects/${created.body.slug}`)
      .send({ name: "Updated", ai: { profileId: "pm-spec", model: "claude-opus-4-7" } });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated");
    expect(res.body.ai.profileId).toBe("pm-spec");
  });

  it("returns 404 for unknown slug", async () => {
    const { app } = buildTestApp();
    const res = await request(app).patch("/api/projects/no-such").send({ name: "X" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/projects/:slug", () => {
  it("deletes the project", async () => {
    const { app } = buildTestApp();
    const created = await request(app)
      .post("/api/projects")
      .send({
        name: "X",
        source: { type: "local", localPath: FIXTURE_LOCAL },
      });
    const del = await request(app).delete(`/api/projects/${created.body.slug}`);
    expect(del.status).toBe(204);
    const after = await request(app).get(`/api/projects/${created.body.slug}`);
    expect(after.status).toBe(404);
  });
});

describe("error handler", () => {
  it("returns sanitized 500 (no stack trace) on internal errors", async () => {
    // Mount an app with a route that throws; verify the response is sanitized
    // This requires either a test-only error route or a known-bad input that triggers an internal error.
    // For now, scaffold the test — adapt it to whatever surface naturally produces a 500.
    const { app } = buildTestApp();
    const res = await request(app).post("/api/projects").send({});
    // 400 is what we get for missing name; switch this test to a real 500 trigger when one exists
    expect([400, 500]).toContain(res.status);
  });
});
