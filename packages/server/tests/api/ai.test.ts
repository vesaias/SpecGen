import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/api/app.js";
import { migrate } from "../../src/db/migrate.js";
import { openDb } from "../../src/db/sqlite.js";
import { SqliteProjectRepository } from "../../src/repositories/SqliteProjectRepository.js";
import { resetClaudeCodeDetectorCache } from "../../src/services/claudeCodeDetector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(__dirname, "../../src/db/migrations");
const PACKAGED_PROFILES = path.resolve(__dirname, "../../../core/profiles");

function buildTestApp() {
  const dir = mkdtempSync(path.join(tmpdir(), "specgen-ai-test-"));
  const db = openDb(path.join(dir, "test.db"));
  migrate(db, MIGRATIONS);
  const projects = new SqliteProjectRepository(db);
  const app = buildApp({ projects, packagedProfilesDir: PACKAGED_PROFILES });
  return { app, projects, dir };
}

beforeEach(() => {
  resetClaudeCodeDetectorCache();
});

describe("GET /api/ai/providers", () => {
  it("lists six providers with configured + subscriptionBased flags", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/ai/providers");
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((p) => p.id).sort();
    expect(ids).toEqual([
      "claude_api",
      "claude_code",
      "local",
      "ollama",
      "openai",
      "openai_compat",
    ]);
  });

  it("local provider is always configured", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/ai/providers");
    const local = (res.body as Array<{ id: string; configured: boolean }>).find(
      (p) => p.id === "local",
    );
    expect(local?.configured).toBe(true);
  });

  it("claude_api configured-flag reflects ANTHROPIC_API_KEY env", async () => {
    const { app } = buildTestApp();
    // biome-ignore lint/performance/noDelete: process.env delete is the only way to truly unset an env var
    delete process.env.ANTHROPIC_API_KEY;
    const res1 = await request(app).get("/api/ai/providers");
    const claudeApi1 = (res1.body as Array<{ id: string; configured: boolean }>).find(
      (p) => p.id === "claude_api",
    );
    expect(claudeApi1?.configured).toBe(false);

    process.env.ANTHROPIC_API_KEY = "test-key";
    const res2 = await request(app).get("/api/ai/providers");
    const claudeApi2 = (res2.body as Array<{ id: string; configured: boolean }>).find(
      (p) => p.id === "claude_api",
    );
    expect(claudeApi2?.configured).toBe(true);
    // biome-ignore lint/performance/noDelete: process.env delete is the only way to truly unset an env var
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("each provider includes a non-empty models list", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/ai/providers");
    for (const p of res.body as Array<{ id: string; models: unknown[] }>) {
      expect(p.models.length).toBeGreaterThan(0);
    }
  });

  it("claude_code reports subscriptionBased: true; claude_api reports subscriptionBased: false", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/ai/providers");
    const list = res.body as Array<{ id: string; subscriptionBased: boolean }>;
    expect(list.find((p) => p.id === "claude_code")?.subscriptionBased).toBe(true);
    expect(list.find((p) => p.id === "claude_api")?.subscriptionBased).toBe(false);
  });
});

describe("POST /api/projects/:slug/ai/test", () => {
  it("returns 404 when project does not exist", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/projects/no-such/ai/test").send({ prompt: "x" });
    expect(res.status).toBe(404);
  });

  it("returns 400 when neither itemId nor prompt provided", async () => {
    const { app, projects } = buildTestApp();
    const tmpDir = mkdtempSync(path.join(tmpdir(), "specgen-proj-"));
    projects.create({
      name: "X",
      source: { type: "local", localPath: tmpDir },
      ai: { provider: "local" },
    });
    const res = await request(app).post("/api/projects/x/ai/test").send({});
    expect(res.status).toBe(400);
  });

  it("returns 400 with hint when AI provider is missing", async () => {
    const { app, projects } = buildTestApp();
    const tmpDir = mkdtempSync(path.join(tmpdir(), "specgen-proj-"));
    projects.create({ name: "no-ai", source: { type: "local", localPath: tmpDir } });
    const res = await request(app)
      .post("/api/projects/no-ai/ai/test")
      .send({ prompt: "Describe Y" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("AI provider not configured");
    expect(typeof res.body.hint).toBe("string");
  });

  it("returns 400 when provider is the local stub", async () => {
    const { app, projects } = buildTestApp();
    const tmpDir = mkdtempSync(path.join(tmpdir(), "specgen-proj-"));
    projects.create({
      name: "X",
      source: { type: "local", localPath: tmpDir },
      ai: { provider: "local", profileId: "pm-spec" },
    });
    // The local stub provider only emits deterministic "stub output" that
    // fails JSON parse on every item, so it counts as "not usable" for the
    // gate even though it's technically a provider.
    const res = await request(app).post("/api/projects/x/ai/test").send({ prompt: "Describe Y" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("AI provider not configured");
  });
});
