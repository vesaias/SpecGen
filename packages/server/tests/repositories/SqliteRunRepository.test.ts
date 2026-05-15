import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import { openDb } from "../../src/db/sqlite.js";
import { SqliteProjectRepository } from "../../src/repositories/SqliteProjectRepository.js";
import { SqliteRunRepository } from "../../src/repositories/SqliteRunRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(__dirname, "../../src/db/migrations");

interface Setup {
  runs: SqliteRunRepository;
  projects: SqliteProjectRepository;
  projectId: string;
  dbDir: string;
}

function setup(): Setup {
  const dbDir = mkdtempSync(path.join(tmpdir(), "specgen-runs-"));
  const db = openDb(path.join(dbDir, "test.db"));
  migrate(db, MIGRATIONS);
  const projects = new SqliteProjectRepository(db);
  const runs = new SqliteRunRepository(db);
  // Seed a project so FK constraints are satisfied
  const project = projects.create({
    name: "Test",
    source: { type: "local", localPath: "/tmp/test" },
  });
  return { runs, projects, projectId: project.id, dbDir };
}

describe("SqliteRunRepository", () => {
  it("create returns a RunRow with status='queued' and zeroed stats", () => {
    const { runs, projectId } = setup();
    const r = runs.create({
      projectId,
      generatorId: "full-tree-spec",
      profileId: "pm-spec",
    });
    expect(r.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(r.status).toBe("queued");
    expect(r.project_id).toBe(projectId);
    expect(r.generator_id).toBe("full-tree-spec");
    expect(r.profile_id).toBe("pm-spec");
    expect(r.started_at).toBeNull();
    expect(r.finished_at).toBeNull();
    expect(r.duration_ms).toBeNull();
    expect(r.stats.itemsCreated).toBe(0);
    expect(r.stats.aiCalls).toEqual([]);
  });

  it("findById returns the row, or null if not found", () => {
    const { runs, projectId } = setup();
    const created = runs.create({ projectId, generatorId: "g", profileId: "pm-spec" });
    expect(runs.findById(created.id)?.id).toBe(created.id);
    expect(runs.findById("01ABCDEFGHJKMNPQRSTVWXYZ12")).toBeNull();
  });

  it("listByProjectId returns newest first", async () => {
    const { runs, projectId } = setup();
    const a = runs.create({ projectId, generatorId: "g", profileId: "p" });
    await new Promise((r) => setTimeout(r, 5)); // ensure differing created_at
    const b = runs.create({ projectId, generatorId: "g", profileId: "p" });
    const list = runs.listByProjectId(projectId);
    expect(list.length).toBe(2);
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });

  it("listByProjectId returns empty for unknown project id", () => {
    const { runs } = setup();
    expect(runs.listByProjectId("01000000000000000000000000")).toEqual([]);
  });

  it("updateStatus partially updates given fields, leaves others alone", () => {
    const { runs, projectId } = setup();
    const r = runs.create({ projectId, generatorId: "g", profileId: "p" });
    runs.updateStatus(r.id, "running", { startedAt: "2026-05-10T10:00:00.000Z" });
    let row = runs.findById(r.id);
    expect(row?.status).toBe("running");
    expect(row?.started_at).toBe("2026-05-10T10:00:00.000Z");
    expect(row?.finished_at).toBeNull();

    runs.updateStatus(r.id, "success", {
      finishedAt: "2026-05-10T10:00:01.500Z",
      logPath: "/tmp/r.jsonl",
    });
    row = runs.findById(r.id);
    expect(row?.status).toBe("success");
    expect(row?.started_at).toBe("2026-05-10T10:00:00.000Z");
    expect(row?.finished_at).toBe("2026-05-10T10:00:01.500Z");
    expect(row?.log_path).toBe("/tmp/r.jsonl");
    // duration_ms auto-computed from started_at + finished_at
    expect(row?.duration_ms).toBe(1500);
  });

  it("updateStatus does not compute duration when started_at is missing", () => {
    const { runs, projectId } = setup();
    const r = runs.create({ projectId, generatorId: "g", profileId: "p" });
    runs.updateStatus(r.id, "failed", {
      finishedAt: "2026-05-10T10:00:01.000Z",
      errorText: "boom",
    });
    const row = runs.findById(r.id);
    expect(row?.error_text).toBe("boom");
    expect(row?.duration_ms).toBeNull();
  });

  it("updateStats persists the RunSummary as JSON", () => {
    const { runs, projectId } = setup();
    const r = runs.create({ projectId, generatorId: "g", profileId: "p" });
    runs.updateStats(r.id, {
      itemsCreated: 5,
      itemsUpdated: 2,
      itemsRemoved: 0,
      warnings: 1,
      aiCalls: [
        {
          itemId: "x",
          provider: "claude_api",
          model: "claude-sonnet-4-6",
          durationMs: 1200,
          costUsd: 0.0015,
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
          },
          status: "ok",
        },
      ],
      aiCostUsdTotal: 0.0015,
    });
    const row = runs.findById(r.id);
    expect(row?.stats.itemsCreated).toBe(5);
    expect(row?.stats.aiCalls).toHaveLength(1);
    expect(row?.stats.aiCostUsdTotal).toBeCloseTo(0.0015, 5);
  });

  it("delete removes the row and unlinks log_path file if present", () => {
    const { runs, projectId, dbDir } = setup();
    const logPath = path.join(dbDir, "run.jsonl");
    writeFileSync(logPath, '{"type":"progress"}\n', "utf8");
    const r = runs.create({ projectId, generatorId: "g", profileId: "p" });
    runs.updateStatus(r.id, "success", { logPath });
    expect(existsSync(logPath)).toBe(true);

    runs.delete(r.id);
    expect(runs.findById(r.id)).toBeNull();
    expect(existsSync(logPath)).toBe(false);
  });

  it("delete tolerates missing log file (no throw)", () => {
    const { runs, projectId } = setup();
    const r = runs.create({ projectId, generatorId: "g", profileId: "p" });
    runs.updateStatus(r.id, "success", { logPath: "/no/such/file.jsonl" });
    expect(() => runs.delete(r.id)).not.toThrow();
    expect(runs.findById(r.id)).toBeNull();
  });

  it("CASCADE delete: removing a project removes its runs", () => {
    const { runs, projects, projectId } = setup();
    runs.create({ projectId, generatorId: "g", profileId: "p" });
    runs.create({ projectId, generatorId: "g", profileId: "p" });
    const project = projects.findBySlug("test");
    if (project) projects.delete(project.slug);
    expect(runs.listByProjectId(projectId)).toEqual([]);
  });

  it("markInterruptedOnBoot transitions queued + running rows to interrupted with finished_at", () => {
    const { runs, projectId } = setup();
    const queued = runs.create({ projectId, generatorId: "g", profileId: "p" });
    const running = runs.create({ projectId, generatorId: "g", profileId: "p" });
    runs.updateStatus(running.id, "running", { startedAt: "2026-05-10T10:00:00.000Z" });
    const success = runs.create({ projectId, generatorId: "g", profileId: "p" });
    runs.updateStatus(success.id, "success", {
      startedAt: "2026-05-10T10:00:00.000Z",
      finishedAt: "2026-05-10T10:00:00.500Z",
    });

    const count = runs.markInterruptedOnBoot();
    expect(count).toBe(2);

    expect(runs.findById(queued.id)?.status).toBe("interrupted");
    expect(runs.findById(queued.id)?.finished_at).toBeTruthy();
    expect(runs.findById(running.id)?.status).toBe("interrupted");
    expect(runs.findById(success.id)?.status).toBe("success"); // untouched
  });
});
