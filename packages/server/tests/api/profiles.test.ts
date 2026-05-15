import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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
const MIGRATIONS = path.resolve(__dirname, "../../src/db/migrations");
const PACKAGED_PROFILES = path.resolve(__dirname, "../../../core/profiles");

function buildTestApp() {
  const dir = mkdtempSync(path.join(tmpdir(), "specgen-profiles-test-"));
  const db = openDb(path.join(dir, "test.db"));
  migrate(db, MIGRATIONS);
  const projects = new SqliteProjectRepository(db);
  const app = buildApp({ projects, packagedProfilesDir: PACKAGED_PROFILES });
  return { app, projects, dir };
}

describe("GET /api/profiles", () => {
  it("lists shipped profiles", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/profiles");
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain("pm-spec");
  });
});

describe("GET /api/profiles/:id", () => {
  it("returns manifest + file list for a known profile", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/profiles/pm-spec");
    expect(res.status).toBe(200);
    expect(res.body.manifest.id).toBe("pm-spec");
    expect(Array.isArray(res.body.files)).toBe(true);
    expect(res.body.files).toContain("profile.yaml");
    expect(res.body.files.some((f: string) => f.startsWith("prompts/"))).toBe(true);
  });

  it("returns 404 for unknown profile", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/profiles/no-such");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/profiles/:id/file", () => {
  it("returns raw file contents (text/plain)", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/profiles/pm-spec/file?path=profile.yaml");
    expect(res.status).toBe(200);
    expect(res.text).toContain("id: pm-spec");
  });

  it("returns 400 for invalid file path", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/profiles/pm-spec/file?path=../etc/passwd");
    expect(res.status).toBe(400);
  });

  it("returns 404 for valid path that doesn't exist in profile", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/profiles/pm-spec/file?path=prompts/nonexistent.md");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/projects/:slug/profiles/:id/file", () => {
  it("creates an override file under <projectRoot>/.specgen/profiles/<id>/", async () => {
    const { app, projects } = buildTestApp();
    const projectRoot = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({ name: "X", source: { type: "local", localPath: projectRoot } });

    const res = await request(app)
      .patch("/api/projects/x/profiles/pm-spec/file?path=prompts/backend-endpoint.md")
      .set("Content-Type", "text/plain")
      .send("# overridden prompt body");

    expect(res.status).toBe(200);

    // File created on disk
    const overridePath = path.join(
      projectRoot,
      ".specgen",
      "profiles",
      "pm-spec",
      "prompts",
      "backend-endpoint.md",
    );
    expect(existsSync(overridePath)).toBe(true);
    expect(readFileSync(overridePath, "utf8")).toBe("# overridden prompt body");
  });

  it("rejects path traversal in path query", async () => {
    const { app, projects } = buildTestApp();
    const projectRoot = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({ name: "X", source: { type: "local", localPath: projectRoot } });

    const res = await request(app)
      .patch("/api/projects/x/profiles/pm-spec/file?path=../../escape.md")
      .set("Content-Type", "text/plain")
      .send("malicious");
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown project", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .patch("/api/projects/no-such/profiles/pm-spec/file?path=README.md")
      .set("Content-Type", "text/plain")
      .send("text");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/projects/:slug/profiles/:id/fork", () => {
  it("scaffolds .specgen/profiles/<id>/profile.yaml extending base", async () => {
    const { app, projects } = buildTestApp();
    const projectRoot = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({ name: "X", source: { type: "local", localPath: projectRoot } });

    const res = await request(app).post("/api/projects/x/profiles/pm-spec/fork");
    expect(res.status).toBe(201);

    const yamlPath = path.join(projectRoot, ".specgen", "profiles", "pm-spec", "profile.yaml");
    expect(existsSync(yamlPath)).toBe(true);
    const content = readFileSync(yamlPath, "utf8");
    expect(content).toMatch(/extends:\s*pm-spec/);
    expect(content).toMatch(/id:\s*pm-spec/);
  });

  it("returns 409 if a fork already exists", async () => {
    const { app, projects } = buildTestApp();
    const projectRoot = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({ name: "X", source: { type: "local", localPath: projectRoot } });

    await request(app).post("/api/projects/x/profiles/pm-spec/fork");
    const res = await request(app).post("/api/projects/x/profiles/pm-spec/fork");
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/projects/:slug/profiles/:id/file", () => {
  it("removes an override file", async () => {
    const { app, projects } = buildTestApp();
    const projectRoot = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({ name: "X", source: { type: "local", localPath: projectRoot } });

    // First, create an override
    await request(app)
      .patch("/api/projects/x/profiles/pm-spec/file?path=README.md")
      .set("Content-Type", "text/plain")
      .send("custom");

    // Then delete it
    const res = await request(app).delete("/api/projects/x/profiles/pm-spec/file?path=README.md");
    expect(res.status).toBe(204);

    const filePath = path.join(projectRoot, ".specgen", "profiles", "pm-spec", "README.md");
    expect(existsSync(filePath)).toBe(false);
  });
});

describe("DELETE /api/projects/:slug/profiles/:id", () => {
  it("removes the entire override profile dir", async () => {
    const { app, projects } = buildTestApp();
    const projectRoot = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({ name: "X", source: { type: "local", localPath: projectRoot } });

    await request(app).post("/api/projects/x/profiles/pm-spec/fork");

    const res = await request(app).delete("/api/projects/x/profiles/pm-spec");
    expect(res.status).toBe(204);

    const dirPath = path.join(projectRoot, ".specgen", "profiles", "pm-spec");
    expect(existsSync(dirPath)).toBe(false);
  });
});
