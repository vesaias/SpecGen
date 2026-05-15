import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { migrate } from "../db/migrate.js";
import { openDb } from "../db/sqlite.js";
import { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import { TokenStore } from "../services/TokenStore.js";
import { buildApp } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../db/migrations");

function makeApp() {
  const dir = mkdtempSync(path.join(tmpdir(), "specgen-tokens-http-"));
  const db = openDb(path.join(dir, "test.db"));
  migrate(db, MIGRATIONS_DIR);
  const projects = new SqliteProjectRepository(db);
  // create a project so :slug resolves
  const p = projects.create({ name: "P One", source: { type: "local", localPath: tmpdir() } });
  const tokens = new TokenStore(db, Buffer.alloc(32, 7));
  const app = buildApp({
    projects,
    packagedProfilesDir: path.resolve(__dirname, "../../../core/profiles"),
    tokens,
  });
  return { app, slug: p.slug };
}

describe("PUT /api/v0/projects/:slug/tokens/:provider", () => {
  it("400 when :provider is not allowlisted", async () => {
    const { app, slug } = makeApp();
    const res = await request(app)
      .put(`/api/v0/projects/${slug}/tokens/bogus`)
      .send({ provider: "bogus", token: "x" });
    expect(res.status).toBe(400);
  });

  it("400 when label is over 200 chars", async () => {
    const { app, slug } = makeApp();
    const res = await request(app)
      .put(`/api/v0/projects/${slug}/tokens/github`)
      .send({ provider: "github", token: "ghp_xyz", label: "x".repeat(201) });
    expect(res.status).toBe(400);
  });

  it("403 when Origin header is a different host", async () => {
    const { app, slug } = makeApp();
    const res = await request(app)
      .put(`/api/v0/projects/${slug}/tokens/github`)
      .set("Origin", "https://evil.example")
      .send({ provider: "github", token: "ghp_xyz" });
    expect(res.status).toBe(403);
  });

  it("200 when Origin header is absent (CLI / curl path)", async () => {
    const { app, slug } = makeApp();
    const res = await request(app)
      .put(`/api/v0/projects/${slug}/tokens/github`)
      .send({ provider: "github", token: "ghp_xyz" });
    expect(res.status).toBe(200);
  });
});

describe("DELETE /api/v0/projects/:slug/tokens/:provider", () => {
  it("400 when :provider not allowlisted", async () => {
    const { app, slug } = makeApp();
    const res = await request(app).delete(`/api/v0/projects/${slug}/tokens/bogus`);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v0/projects/:slug/tokens", () => {
  it("returns redacted list, no plaintext", async () => {
    const { app, slug } = makeApp();
    await request(app)
      .put(`/api/v0/projects/${slug}/tokens/github`)
      .send({ provider: "github", token: "ghp_supersecret_xyz1234" });
    const res = await request(app).get(`/api/v0/projects/${slug}/tokens`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("ghp_supersecret_xyz1234");
    expect(res.body[0].last4).toBe("1234");
  });
});
