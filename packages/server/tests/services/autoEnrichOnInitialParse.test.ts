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
import { describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import { openDb } from "../../src/db/sqlite.js";
import { SqliteProjectRepository } from "../../src/repositories/SqliteProjectRepository.js";
import { SqliteRunRepository } from "../../src/repositories/SqliteRunRepository.js";
import { RunEventBroker } from "../../src/services/RunEventBroker.js";
import { RunWorker } from "../../src/services/RunWorker.js";
import { installAutoEnrichOnInitialParse } from "../../src/services/autoEnrichOnInitialParse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(__dirname, "../../src/db/migrations");
const PACKAGED_PROFILES = path.resolve(__dirname, "../../../core/profiles");

/**
 * A generator stub whose only job is to yield a `done` event with a caller-
 * supplied `itemsCreated`. We register it under `full-tree-spec` for these
 * tests so the auto-enrich listener sees the matching generatorId.
 */
function makeFakeFullTreeSpec(itemsCreated: number): GeneratorPlugin {
  return {
    id: "full-tree-spec",
    name: "Fake full-tree-spec",
    description: "test stub",
    supports_profiles: "*",
    supports_parsers: "*",
    produces_item_types: [],
    async *run() {
      yield {
        type: "done",
        stats: { ...emptyRunSummary(), itemsCreated },
      };
    },
  };
}

/**
 * A generator stub registered under the id `enrichment-pipeline`. It records
 * whether `run` was invoked and yields done immediately.
 */
function makeFakeEnrichmentPipeline(recorder: { invoked: boolean }): GeneratorPlugin {
  return {
    id: "enrichment-pipeline",
    name: "Fake enrichment-pipeline",
    description: "test stub",
    supports_profiles: "*",
    supports_parsers: "*",
    produces_item_types: [],
    async *run() {
      recorder.invoked = true;
      yield { type: "done", stats: emptyRunSummary() };
    },
  };
}

interface Setup {
  worker: RunWorker;
  projects: SqliteProjectRepository;
  runs: SqliteRunRepository;
  pipelineRecorder: { invoked: boolean };
}

function setup(opts: {
  ai: Record<string, unknown>;
  fullTreeItemsCreated: number;
}): Setup & { projectId: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "specgen-auto-enrich-"));
  const db = openDb(path.join(dir, "test.db"));
  migrate(db, MIGRATIONS);
  const projects = new SqliteProjectRepository(db);
  const runs = new SqliteRunRepository(db);
  const broker = new RunEventBroker(path.join(dir, "logs"));

  const localPath = mkdtempSync(path.join(tmpdir(), "specgen-projroot-"));
  const project = projects.create({
    name: "AutoEnrich Test",
    source: { type: "local", localPath },
    ai: opts.ai,
  });

  const parserRegistry = new ParserRegistry();
  const generatorRegistry = new GeneratorRegistry();
  generatorRegistry.register(makeFakeFullTreeSpec(opts.fullTreeItemsCreated));
  const pipelineRecorder = { invoked: false };
  generatorRegistry.register(makeFakeEnrichmentPipeline(pipelineRecorder));

  const worker = new RunWorker({
    projects,
    runs,
    broker,
    packagedProfilesDir: PACKAGED_PROFILES,
    parserRegistry,
    generatorRegistry,
  });

  installAutoEnrichOnInitialParse({ worker, projects, runs });

  return { worker, projects, runs, pipelineRecorder, projectId: project.id };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("autoEnrichOnInitialParse", () => {
  it("after an initial full-tree-spec run with itemsCreated>0 and a configured AI provider, enqueues an enrichment-pipeline run in 'initial' mode", async () => {
    const { worker, runs, pipelineRecorder, projectId } = setup({
      ai: { provider: "anthropic", profileId: "pm-spec" },
      fullTreeItemsCreated: 5,
    });
    const enqueueSpy = vi.spyOn(worker, "enqueue");

    const parseRunId = worker.enqueue({
      projectId,
      generatorId: "full-tree-spec",
      profileId: "pm-spec",
    });
    await waitFor(() => runs.findById(parseRunId)?.status === "success");
    // Listener fires synchronously inside executeRun after status is written;
    // it calls enqueue() again, which is itself synchronous. Wait for the
    // follow-up generator to actually execute.
    await waitFor(() => pipelineRecorder.invoked);

    expect(enqueueSpy).toHaveBeenCalledTimes(2);
    const followUpInput = enqueueSpy.mock.calls[1][0];
    expect(followUpInput.generatorId).toBe("enrichment-pipeline");
    expect(followUpInput.profileId).toBe("pm-spec");
    expect(followUpInput.options).toEqual({ mode: "initial" });
    expect(followUpInput.projectId).toBe(projectId);
  });

  it("does NOT auto-enqueue when the AI provider is the 'local' stub", async () => {
    const { worker, runs, pipelineRecorder, projectId } = setup({
      ai: { provider: "local" },
      fullTreeItemsCreated: 5,
    });
    const enqueueSpy = vi.spyOn(worker, "enqueue");

    const parseRunId = worker.enqueue({
      projectId,
      generatorId: "full-tree-spec",
      profileId: "pm-spec",
    });
    await waitFor(() => runs.findById(parseRunId)?.status === "success");
    // Give the listener a tick to run.
    await new Promise((r) => setTimeout(r, 50));

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(pipelineRecorder.invoked).toBe(false);
  });

  it("does NOT auto-enqueue when itemsCreated is 0 (re-parse with no new items)", async () => {
    const { worker, runs, pipelineRecorder, projectId } = setup({
      ai: { provider: "anthropic" },
      fullTreeItemsCreated: 0,
    });
    const enqueueSpy = vi.spyOn(worker, "enqueue");

    const parseRunId = worker.enqueue({
      projectId,
      generatorId: "full-tree-spec",
      profileId: "pm-spec",
    });
    await waitFor(() => runs.findById(parseRunId)?.status === "success");
    await new Promise((r) => setTimeout(r, 50));

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(pipelineRecorder.invoked).toBe(false);
  });

  it("does NOT auto-enqueue on a second successful parse (re-parse) even with itemsCreated>0", async () => {
    const { worker, runs, pipelineRecorder, projectId } = setup({
      ai: { provider: "anthropic", profileId: "pm-spec" },
      fullTreeItemsCreated: 3,
    });

    // First parse: triggers auto-enrich.
    const firstRunId = worker.enqueue({
      projectId,
      generatorId: "full-tree-spec",
      profileId: "pm-spec",
    });
    await waitFor(() => runs.findById(firstRunId)?.status === "success");
    await waitFor(() => pipelineRecorder.invoked);

    // Reset the recorder and run another full-tree-spec; this is no longer
    // the "initial" parse so we should NOT see a second pipeline run.
    pipelineRecorder.invoked = false;
    const secondRunId = worker.enqueue({
      projectId,
      generatorId: "full-tree-spec",
      profileId: "pm-spec",
    });
    await waitFor(() => runs.findById(secondRunId)?.status === "success");
    await new Promise((r) => setTimeout(r, 50));

    expect(pipelineRecorder.invoked).toBe(false);
  });
});
