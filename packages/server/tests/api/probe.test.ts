import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ParserRegistry, subdirAwarePlugin } from "@specgen/core";
import { dotnetParser } from "@specgen/parser-dotnet";
import { pythonParser } from "@specgen/parser-python";
import { reactParser } from "@specgen/parser-react";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/api/app.js";
import { migrate } from "../../src/db/migrate.js";
import { openDb } from "../../src/db/sqlite.js";
import { SqliteProjectRepository } from "../../src/repositories/SqliteProjectRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");
const PACKAGED_PROFILES = path.resolve(__dirname, "../../../core/profiles");

const MOCKPMS_PATH = process.env.SPECGEN_MOCKPMS_PATH;

function buildParsers() {
  const registry = new ParserRegistry();
  registry.register(subdirAwarePlugin(dotnetParser));
  registry.register(subdirAwarePlugin(reactParser));
  registry.register(subdirAwarePlugin(pythonParser));
  return registry;
}

function buildTestApp() {
  const dir = mkdtempSync(path.join(tmpdir(), "specgen-probe-test-"));
  const db = openDb(path.join(dir, "test.db"));
  migrate(db, MIGRATIONS_DIR);
  const projects = new SqliteProjectRepository(db);
  const parsers = buildParsers();
  const app = buildApp({ projects, packagedProfilesDir: PACKAGED_PROFILES, parsers });
  return { app };
}

describe("POST /api/v0/projects/probe", () => {
  it("returns canParse=true for MockPMS local directory (skipped if SPECGEN_MOCKPMS_PATH unset)", async () => {
    if (!MOCKPMS_PATH) {
      console.log("  [skip] SPECGEN_MOCKPMS_PATH not set — skipping MockPMS probe test");
      return;
    }
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v0/projects/probe")
      .send({ source: { type: "local", localPath: MOCKPMS_PATH } });

    expect(res.status).toBe(200);
    expect(res.body.canParse).toBe(true);
    expect(res.body.matches.find((m: { parser: string }) => m.parser === "dotnet")).toBeTruthy();
    expect(res.body.suggestedProfile).toBe("pm-spec");
    expect(Array.isArray(res.body.languagesDetected)).toBe(true);
  });

  it("returns canParse=true with python in languagesDetected for a Python-only dir", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-probe-py-"));
    // parser-python's detect() needs a marker file (pyproject.toml /
    // requirements.txt / setup.py) OR 3+ .py files to claim the repo.
    writeFileSync(path.join(dir, "main.py"), "print('hello')\n");
    writeFileSync(path.join(dir, "requirements.txt"), "fastapi==0.110\n");

    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v0/projects/probe")
      .send({ source: { type: "local", localPath: dir } });

    expect(res.status).toBe(200);
    // parser-python is registered, so a Python-only dir is parseable now.
    expect(res.body.canParse).toBe(true);
    const python = res.body.languagesDetected.find(
      (l: { language: string }) => l.language === "python",
    );
    expect(python).toBeTruthy();
    expect(python.fileCount).toBe(1);
    expect(python.parserAvailable).toBe(true);
  });

  it("returns rejected array listing parsers that produced confidence 0", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "specgen-probe-empty-"));
    writeFileSync(path.join(dir, "README.md"), "# Hello\n");

    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v0/projects/probe")
      .send({ source: { type: "local", localPath: dir } });

    expect(res.status).toBe(200);
    expect(res.body.canParse).toBe(false);
    expect(Array.isArray(res.body.rejected)).toBe(true);
    expect(res.body.rejected.length).toBeGreaterThan(0);
    // Every rejection has expected fields
    for (const rej of res.body.rejected as Array<{
      parser: string;
      reason: string;
      lookedAt: string[];
    }>) {
      expect(typeof rej.parser).toBe("string");
      expect(typeof rej.reason).toBe("string");
      expect(Array.isArray(rej.lookedAt)).toBe(true);
    }
  });

  it("returns 400 for a localPath that does not exist", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v0/projects/probe")
      .send({ source: { type: "local", localPath: "/does/not/exist/xyz123" } });

    expect(res.status).toBe(400);
  });

  it("returns 400 for an unsupported source.type", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v0/projects/probe")
      .send({ source: { type: "sftp", host: "example.com" } });

    expect(res.status).toBe(400);
  });

  it("returns 400 when source is missing from body", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/v0/projects/probe").send({});

    expect(res.status).toBe(400);
  });

  it("returns 400 for github source without required fields", async () => {
    const { app } = buildTestApp();
    const res = await request(app)
      .post("/api/v0/projects/probe")
      .send({ source: { type: "github", owner: "acme" } }); // missing repo + token

    expect(res.status).toBe(400);
  });
});
