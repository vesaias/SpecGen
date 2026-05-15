import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type GeneratorPlugin,
  GeneratorRegistry,
  ParserRegistry,
  emptyRunSummary,
} from "@specgen/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import { openDb } from "../../src/db/sqlite.js";
import { ConfluencePageMapRepository } from "../../src/repositories/ConfluencePageMapRepository.js";
import { GitDocsStateRepository } from "../../src/repositories/GitDocsStateRepository.js";
import { SqliteProjectRepository } from "../../src/repositories/SqliteProjectRepository.js";
import { SqliteRunRepository } from "../../src/repositories/SqliteRunRepository.js";
import { RunEventBroker } from "../../src/services/RunEventBroker.js";
import { RunWorker } from "../../src/services/RunWorker.js";
import { TokenStore } from "../../src/services/TokenStore.js";
import { installAutoPushOnRunComplete } from "../../src/services/autoPushOnRunComplete.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(__dirname, "../../src/db/migrations");
const PACKAGED_PROFILES = path.resolve(__dirname, "../../../core/profiles");

// ---------------------------------------------------------------------------
// Stub @specgen/connector-git-docs.DocsPushService so the test doesn't hit
// the network. The push call is recorded by the gitDocsPushCalled spy
// that's exposed via vi.hoisted so the mock factory can read it.
// ---------------------------------------------------------------------------

const recorder = vi.hoisted(() => ({ gitDocsPushCalled: 0 }));

vi.mock("@specgen/connector-git-docs", async (importOriginal) => {
  const original = await importOriginal<typeof import("@specgen/connector-git-docs")>();
  return {
    ...original,
    DocsPushService: class FakeDocsPushService {
      async run() {
        recorder.gitDocsPushCalled++;
        return { pushedSha: "fakeSha", filesWritten: 1 };
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Generator stubs — register fake full-tree-spec, enrichment-pipeline,
// confluence-push, frontend-capture so the worker can route to them.
// ---------------------------------------------------------------------------

function makeStubGenerator(id: string): GeneratorPlugin {
  return {
    id,
    name: `Fake ${id}`,
    description: "stub",
    supports_profiles: "*",
    supports_parsers: "*",
    produces_item_types: [],
    async *run() {
      yield { type: "done", stats: emptyRunSummary() };
    },
  };
}

interface Setup {
  worker: RunWorker;
  projects: SqliteProjectRepository;
  runs: SqliteRunRepository;
  tokens: TokenStore;
  gitDocsState: GitDocsStateRepository;
  confluencePageMap: ConfluencePageMapRepository;
  projectId: string;
  setConnectors(connectors: Record<string, unknown>): void;
  setGitHubToken(): Promise<void>;
  setConfluenceToken(): Promise<void>;
}

function setup(): Setup {
  const dir = mkdtempSync(path.join(tmpdir(), "specgen-auto-push-"));
  const db = openDb(path.join(dir, "test.db"));
  migrate(db, MIGRATIONS);
  const projects = new SqliteProjectRepository(db);
  const runs = new SqliteRunRepository(db);
  const broker = new RunEventBroker(path.join(dir, "logs"));
  const tokens = new TokenStore(db, Buffer.alloc(32, "k"));
  const gitDocsState = new GitDocsStateRepository(db);
  const confluencePageMap = new ConfluencePageMapRepository(db);

  const localPath = mkdtempSync(path.join(tmpdir(), "specgen-auto-push-root-"));
  const project = projects.create({
    name: "AutoPush Test",
    source: { type: "local", localPath },
  });

  const parserRegistry = new ParserRegistry();
  const generatorRegistry = new GeneratorRegistry();
  generatorRegistry.register(makeStubGenerator("full-tree-spec"));
  generatorRegistry.register(makeStubGenerator("enrichment-pipeline"));
  generatorRegistry.register(makeStubGenerator("confluence-push"));
  generatorRegistry.register(makeStubGenerator("frontend-capture"));

  const worker = new RunWorker({
    projects,
    runs,
    broker,
    packagedProfilesDir: PACKAGED_PROFILES,
    parserRegistry,
    generatorRegistry,
    tokens,
  });

  installAutoPushOnRunComplete({
    worker,
    projects,
    tokens,
    gitDocsState,
    confluencePageMap,
  });

  return {
    worker,
    projects,
    runs,
    tokens,
    gitDocsState,
    confluencePageMap,
    projectId: project.id,
    setConnectors(connectors) {
      projects.update(project.slug, { connectors });
    },
    async setGitHubToken() {
      await tokens.set(
        { projectId: project.id, provider: "github" },
        { provider: "github", token: "ghp_fake" },
      );
    },
    async setConfluenceToken() {
      await tokens.set(
        { projectId: project.id, provider: "confluence" },
        {
          provider: "confluence",
          baseUrl: "https://acme.atlassian.net",
          email: "bot@x",
          apiToken: "tok",
        },
      );
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("autoPushOnRunComplete", () => {
  beforeEach(() => {
    recorder.gitDocsPushCalled = 0;
  });

  it("after a successful enrichment-pipeline run with both connectors auto-enabled, kicks off both pushes", async () => {
    const s = setup();
    s.setConnectors({
      gitDocs: { cloneUrl: "https://github.com/x/y.git", autoPush: true },
      confluence: { spaceKey: "DEMO", autoPush: true },
    });
    await s.setGitHubToken();
    await s.setConfluenceToken();
    const enqueueSpy = vi.spyOn(s.worker, "enqueue");

    const parseRunId = s.worker.enqueue({
      projectId: s.projectId,
      generatorId: "enrichment-pipeline",
      profileId: "pm-spec",
    });
    await waitFor(() => s.runs.findById(parseRunId)?.status === "success");
    // The listener uses Promise.allSettled in a microtask; wait for both
    // pushes to record their side effects.
    await waitFor(() => recorder.gitDocsPushCalled > 0);
    await waitFor(() => enqueueSpy.mock.calls.some((c) => c[0].generatorId === "confluence-push"));

    expect(recorder.gitDocsPushCalled).toBe(1);
    const cfCall = enqueueSpy.mock.calls.find((c) => c[0].generatorId === "confluence-push");
    expect(cfCall).toBeTruthy();
    expect(cfCall?.[0].options).toMatchObject({ spaceKey: "DEMO", projectId: s.projectId });
  });

  it("does NOT trigger any push when neither connector has autoPush=true", async () => {
    const s = setup();
    s.setConnectors({
      gitDocs: { cloneUrl: "https://github.com/x/y.git", autoPush: false },
      confluence: { spaceKey: "DEMO", autoPush: false },
    });
    await s.setGitHubToken();
    await s.setConfluenceToken();
    const enqueueSpy = vi.spyOn(s.worker, "enqueue");

    const runId = s.worker.enqueue({
      projectId: s.projectId,
      generatorId: "enrichment-pipeline",
      profileId: "pm-spec",
    });
    await waitFor(() => s.runs.findById(runId)?.status === "success");
    // Give the listener a tick.
    await new Promise((r) => setTimeout(r, 80));

    expect(recorder.gitDocsPushCalled).toBe(0);
    expect(enqueueSpy.mock.calls.some((c) => c[0].generatorId === "confluence-push")).toBe(false);
  });

  it("does NOT trigger pushes after a frontend-capture run (captures aren't a trigger)", async () => {
    const s = setup();
    s.setConnectors({
      gitDocs: { cloneUrl: "https://github.com/x/y.git", autoPush: true },
      confluence: { spaceKey: "DEMO", autoPush: true },
    });
    await s.setGitHubToken();
    await s.setConfluenceToken();
    const enqueueSpy = vi.spyOn(s.worker, "enqueue");

    const runId = s.worker.enqueue({
      projectId: s.projectId,
      generatorId: "frontend-capture",
      profileId: "pm-spec",
    });
    await waitFor(() => s.runs.findById(runId)?.status === "success");
    await new Promise((r) => setTimeout(r, 80));

    expect(recorder.gitDocsPushCalled).toBe(0);
    expect(enqueueSpy.mock.calls.some((c) => c[0].generatorId === "confluence-push")).toBe(false);
  });

  it("does NOT re-trigger pushes after a confluence-push run (no chain)", async () => {
    const s = setup();
    s.setConnectors({
      gitDocs: { cloneUrl: "https://github.com/x/y.git", autoPush: true },
      confluence: { spaceKey: "DEMO", autoPush: true },
    });
    await s.setGitHubToken();
    await s.setConfluenceToken();

    const runId = s.worker.enqueue({
      projectId: s.projectId,
      generatorId: "confluence-push",
      profileId: "pm-spec",
    });
    await waitFor(() => s.runs.findById(runId)?.status === "success");
    await new Promise((r) => setTimeout(r, 80));

    // confluence-push isn't in the trigger set, so neither push fires.
    expect(recorder.gitDocsPushCalled).toBe(0);
  });

  it("git-docs autoPush=true but no token → skipped, confluence still fires", async () => {
    const s = setup();
    s.setConnectors({
      gitDocs: { cloneUrl: "https://github.com/x/y.git", autoPush: true },
      confluence: { spaceKey: "DEMO", autoPush: true },
    });
    // NO GitHub token, but Confluence token is present.
    await s.setConfluenceToken();
    const enqueueSpy = vi.spyOn(s.worker, "enqueue");

    const runId = s.worker.enqueue({
      projectId: s.projectId,
      generatorId: "full-tree-spec",
      profileId: "pm-spec",
    });
    await waitFor(() => s.runs.findById(runId)?.status === "success");
    await waitFor(() => enqueueSpy.mock.calls.some((c) => c[0].generatorId === "confluence-push"));

    expect(recorder.gitDocsPushCalled).toBe(0);
    expect(enqueueSpy.mock.calls.some((c) => c[0].generatorId === "confluence-push")).toBe(true);
  });

  it("does NOT trigger on a failed run", async () => {
    const s = setup();
    s.setConnectors({
      gitDocs: { cloneUrl: "https://github.com/x/y.git", autoPush: true },
      confluence: { spaceKey: "DEMO", autoPush: true },
    });
    await s.setGitHubToken();
    await s.setConfluenceToken();
    const enqueueSpy = vi.spyOn(s.worker, "enqueue");

    // Drive a "failed" terminal status by emitting a runCompleted manually.
    // We synthesise the event because we'd otherwise need a generator that
    // intentionally errors, which would muddle the table of stubs.
    const emitter = (s.worker as any).emitter as import("node:events").EventEmitter;
    emitter.emit("runCompleted", {
      runId: "fake",
      projectId: s.projectId,
      generatorId: "enrichment-pipeline",
      profileId: "pm-spec",
      status: "failed",
      summary: emptyRunSummary(),
    });
    await new Promise((r) => setTimeout(r, 50));

    expect(recorder.gitDocsPushCalled).toBe(0);
    expect(enqueueSpy.mock.calls.some((c) => c[0].generatorId === "confluence-push")).toBe(false);
  });
});
