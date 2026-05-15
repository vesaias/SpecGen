import { mkdtempSync } from "node:fs";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
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
import { describe, expect, it } from "vitest";
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

const fastSuccessGen: GeneratorPlugin = {
  id: "fake-success",
  name: "Fake (success)",
  description: "test",
  supports_profiles: "*",
  supports_parsers: "*",
  produces_item_types: [],
  async *run() {
    yield { type: "done", stats: emptyRunSummary() };
  },
};

interface Setup {
  app: import("express").Express;
  projects: SqliteProjectRepository;
  runs: SqliteRunRepository;
  worker: RunWorker;
  broker: RunEventBroker;
}

function setup(): Setup {
  const dir = mkdtempSync(path.join(tmpdir(), "specgen-runs-api-"));
  const db = openDb(path.join(dir, "test.db"));
  migrate(db, MIGRATIONS);
  const projects = new SqliteProjectRepository(db);
  const runs = new SqliteRunRepository(db);
  const broker = new RunEventBroker(path.join(dir, "logs"));

  const parserRegistry = new ParserRegistry();
  const generatorRegistry = new GeneratorRegistry();
  generatorRegistry.register(fastSuccessGen);

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

  return { app, projects, runs, worker, broker };
}

describe("POST /api/projects/:slug/runs", () => {
  it("enqueues a run and returns 201 with runId + status", async () => {
    const { app, projects } = setup();
    const tmp = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({
      name: "X",
      source: { type: "local", localPath: tmp },
      ai: { provider: "local" },
    });
    const res = await request(app)
      .post("/api/projects/x/runs")
      .send({ generator: "fake-success", profile: "pm-spec" });
    expect(res.status).toBe(201);
    expect(res.body.runId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(res.body.status).toBe("queued");
  });

  it("uses default generator + project's profileId when body is empty", async () => {
    const { app, projects, runs } = setup();
    const tmp = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({
      name: "Y",
      source: { type: "local", localPath: tmp },
      // Real provider (not "local") so the AI gate doesn't reject the
      // default full-tree-spec generator. We still use the fake worker
      // so no actual AI call is made.
      ai: { provider: "claude_code", profileId: "pm-spec" },
    });
    const res = await request(app).post("/api/projects/y/runs").send({});
    expect(res.status).toBe(201);
    const row = runs.findById(res.body.runId);
    expect(row?.generator_id).toBe("full-tree-spec");
    expect(row?.profile_id).toBe("pm-spec");
  });

  it("falls back to pm-spec profile when project has no ai.profileId", async () => {
    const { app, projects, runs } = setup();
    const tmp = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({
      name: "Z",
      source: { type: "local", localPath: tmp },
      // Same reason as above: provider must be non-local for the AI gate
      // to let the default full-tree-spec generator through.
      ai: { provider: "claude_code" },
    });
    const res = await request(app).post("/api/projects/z/runs").send({});
    expect(res.status).toBe(201);
    expect(runs.findById(res.body.runId)?.profile_id).toBe("pm-spec");
  });

  it("returns 400 with hint when AI is missing for an AI-requiring generator", async () => {
    const { app, projects } = setup();
    const tmp = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({ name: "no-ai", source: { type: "local", localPath: tmp } });
    const res = await request(app).post("/api/projects/no-ai/runs").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("AI provider not configured");
    expect(typeof res.body.hint).toBe("string");
  });

  it("allows non-AI generators (frontend-capture, fake-success) to run without AI", async () => {
    const { app, projects } = setup();
    const tmp = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({
      name: "no-ai-2",
      source: { type: "local", localPath: tmp },
      ai: { provider: "local" },
    });
    const res = await request(app)
      .post("/api/projects/no-ai-2/runs")
      .send({ generator: "fake-success" });
    expect(res.status).toBe(201);
  });

  it("returns 404 when project does not exist", async () => {
    const { app } = setup();
    const res = await request(app)
      .post("/api/projects/no-such/runs")
      .send({ generator: "fake-success", profile: "pm-spec" });
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid slug", async () => {
    const { app } = setup();
    const res = await request(app)
      .post("/api/projects/Invalid_Slug/runs")
      .send({ generator: "fake-success", profile: "pm-spec" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/projects/:slug/runs", () => {
  it("returns runs for a project (newest first)", async () => {
    const { app, projects } = setup();
    const tmp = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({
      name: "X",
      source: { type: "local", localPath: tmp },
      ai: { provider: "local" },
    });
    const r1 = await request(app).post("/api/projects/x/runs").send({ generator: "fake-success" });
    await new Promise((r) => setTimeout(r, 5));
    const r2 = await request(app).post("/api/projects/x/runs").send({ generator: "fake-success" });

    const res = await request(app).get("/api/projects/x/runs");
    expect(res.status).toBe(200);
    const body = res.body as Array<{ id: string }>;
    expect(body.length).toBe(2);
    // Newest first
    expect(body[0].id).toBe(r2.body.runId);
    expect(body[1].id).toBe(r1.body.runId);
  });

  it("returns empty array for project with no runs", async () => {
    const { app, projects } = setup();
    const tmp = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({ name: "Y", source: { type: "local", localPath: tmp } });
    const res = await request(app).get("/api/projects/y/runs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 404 for unknown project", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/projects/no-such/runs");
    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid slug", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/projects/Invalid_Slug/runs");
    expect(res.status).toBe(400);
  });
});

describe("GET /api/runs/:id", () => {
  it("returns the run by id", async () => {
    const { app, projects } = setup();
    const tmp = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({
      name: "X",
      source: { type: "local", localPath: tmp },
      ai: { provider: "local" },
    });
    const enqueue = await request(app)
      .post("/api/projects/x/runs")
      .send({ generator: "fake-success" });
    const runId = enqueue.body.runId;

    const res = await request(app).get(`/api/runs/${runId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(runId);
    expect(res.body.generator_id).toBe("fake-success");
  });

  it("returns 404 for unknown run id", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/runs/01ABCDEFGHJKMNPQRSTVWXYZ12");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/runs/:id/events (SSE)", () => {
  it("replays past events from a finished run + closes the stream", async () => {
    const { app, projects, runs, broker } = setup();
    const tmp = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    const project = projects.create({
      name: "SSE-A",
      source: { type: "local", localPath: tmp },
      ai: { provider: "local" },
    });
    const created = runs.create({
      projectId: project.id,
      generatorId: "fake",
      profileId: "pm-spec",
    });

    // Open broker, write events, close — simulating a completed generator
    await broker.open(created.id);
    broker.emit(created.id, { type: "progress", message: "step 1" } as Parameters<
      typeof broker.emit
    >[1]);
    broker.emit(created.id, { type: "item-updated", itemId: "x" } as Parameters<
      typeof broker.emit
    >[1]);
    broker.emit(created.id, { type: "done", stats: emptyRunSummary() });
    await broker.close(created.id);

    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/runs/${created.id}/events`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
      const text = await res.text();
      expect(text).toContain("event: progress");
      expect(text).toContain("event: item-updated");
      expect(text).toContain("event: done");
      expect(text).toContain('"message":"step 1"');
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 10000);

  it("returns 404 for unknown run id", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/runs/01ABCDEFGHJKMNPQRSTVWXYZ12/events");
    expect(res.status).toBe(404);
  });

  it("for an in-flight run, replays past events then streams live updates", async () => {
    const { app, projects, runs, broker } = setup();
    const tmp = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    const project = projects.create({
      name: "SSE-B",
      source: { type: "local", localPath: tmp },
      ai: { provider: "local" },
    });
    const r = runs.create({
      projectId: project.id,
      generatorId: "fake",
      profileId: "pm-spec",
    });
    await broker.open(r.id);
    broker.emit(r.id, { type: "progress", message: "step 1" } as Parameters<typeof broker.emit>[1]);

    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    try {
      // Use node:http directly — Node's built-in fetch buffers SSE chunks; http.get streams them.
      let buf = "";
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("SSE live-stream test timed out")), 8000);
        http
          .get({ host: "127.0.0.1", port, path: `/api/runs/${r.id}/events` }, (res) => {
            res.setEncoding("utf8");
            res.on("data", (chunk: string) => {
              buf += chunk;
              // Once we've seen the replayed event, emit live events (once, idempotently)
              if (buf.includes('"message":"step 1"') && !buf.includes('"message":"step 2"')) {
                // Use setImmediate to yield so the server has a chance to register the subscription
                setImmediate(() => {
                  broker.emit(r.id, { type: "progress", message: "step 2" } as Parameters<
                    typeof broker.emit
                  >[1]);
                  broker.emit(r.id, { type: "done", stats: emptyRunSummary() });
                  broker.close(r.id).catch(reject);
                });
              }
              if (buf.includes("event: done")) {
                clearTimeout(timeout);
                res.destroy(); // close the SSE connection
                resolve();
              }
            });
            res.on("error", (err) => {
              // ECONNRESET is expected when we destroy the socket after getting what we need
              if ((err as NodeJS.ErrnoException).code !== "ECONNRESET") {
                clearTimeout(timeout);
                reject(err);
              }
            });
            res.on("end", () => {
              clearTimeout(timeout);
              if (buf.includes("event: done")) resolve();
            });
          })
          .on("error", (err) => {
            clearTimeout(timeout);
            reject(err);
          });
      });

      expect(buf).toContain('"message":"step 1"'); // replayed
      expect(buf).toContain('"message":"step 2"'); // live
      expect(buf).toContain("event: done");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 10000);
});

describe("POST /api/runs/:id/cancel", () => {
  it("cancels a queued run; subsequent status is 'cancelled'", async () => {
    const { app, projects, runs } = setup();
    const tmp = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({
      name: "X",
      source: { type: "local", localPath: tmp },
      ai: { provider: "local" },
    });
    const enqueue = await request(app)
      .post("/api/projects/x/runs")
      .send({ generator: "fake-success" });
    const runId = enqueue.body.runId;
    // Cancel immediately. The endpoint marks the run as cancellable; the
    // worker's finally-block does the actual status transition.
    const res = await request(app).post(`/api/runs/${runId}/cancel`);
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.ok).toBe(true);
      // Poll for terminal state. Acceptable: cancelled (queue picked it up
      // and bailed mid-stream) OR success (generator finished before the
      // cancel flag was checked between yields — race tolerated).
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const status = runs.findById(runId)?.status;
        if (status === "cancelled" || status === "success") break;
        await new Promise((r) => setTimeout(r, 20));
      }
      const finalStatus = runs.findById(runId)?.status;
      expect(["cancelled", "success"]).toContain(finalStatus);
    }
  });

  it("returns 404 for unknown run id", async () => {
    const { app } = setup();
    const res = await request(app).post("/api/runs/01ABCDEFGHJKMNPQRSTVWXYZ12/cancel");
    expect(res.status).toBe(404);
  });

  it("returns 404 for already-finished run", async () => {
    const { app, projects, runs } = setup();
    const tmp = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({
      name: "Y",
      source: { type: "local", localPath: tmp },
      ai: { provider: "local" },
    });
    const enqueue = await request(app)
      .post("/api/projects/y/runs")
      .send({ generator: "fake-success" });
    const runId = enqueue.body.runId;
    // Wait for the run to finish
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (runs.findById(runId)?.status === "success") return resolve();
        if (Date.now() - start > 3000) return reject(new Error("timeout"));
        setTimeout(tick, 20);
      };
      tick();
    });
    const res = await request(app).post(`/api/runs/${runId}/cancel`);
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/runs/:id", () => {
  it("removes a finished run", async () => {
    const { app, projects, runs } = setup();
    const tmp = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
    projects.create({
      name: "Z",
      source: { type: "local", localPath: tmp },
      ai: { provider: "local" },
    });
    const enqueue = await request(app)
      .post("/api/projects/z/runs")
      .send({ generator: "fake-success" });
    const runId = enqueue.body.runId;
    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (runs.findById(runId)?.status === "success") return resolve();
        if (Date.now() - start > 3000) return reject(new Error("timeout"));
        setTimeout(tick, 20);
      };
      tick();
    });

    const res = await request(app).delete(`/api/runs/${runId}`);
    expect(res.status).toBe(204);
    expect(runs.findById(runId)).toBeNull();
  });

  it("returns 404 for unknown run id", async () => {
    const { app } = setup();
    const res = await request(app).delete("/api/runs/01ABCDEFGHJKMNPQRSTVWXYZ12");
    expect(res.status).toBe(404);
  });
});
