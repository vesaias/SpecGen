import { EventEmitter } from "node:events";
import {
  AiRouter,
  type GeneratorRegistry,
  JsonSpecRepository,
  LocalClient,
  LocalFs,
  type ParserFileSystem,
  type ParserRegistry,
  ProfileLoader,
  type RunEvent,
  type RunSummary,
  emptyRunSummary,
} from "@specgen/core";
import PQueue from "p-queue";
import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import type { SqliteRunRepository } from "../repositories/SqliteRunRepository.js";
import type { RunEventBroker } from "./RunEventBroker.js";
import type { TokenStore } from "./TokenStore.js";
import { buildAiRouter } from "./aiClientFactory.js";
import { buildGitHubFs } from "./githubFsFactory.js";
import { getProjectDataDir } from "./projectDataDir.js";

export interface RunWorkerDeps {
  projects: SqliteProjectRepository;
  runs: SqliteRunRepository;
  broker: RunEventBroker;
  packagedProfilesDir: string;
  parserRegistry: ParserRegistry;
  generatorRegistry: GeneratorRegistry;
  /**
   * Required for GitHub-source projects to fetch the connector token. Local
   * projects don't need it; the worker only resolves it on the github branch.
   */
  tokens?: TokenStore;
}

export interface RunWorkerOptions {
  /** Default: 1 (single worker for single-user model). */
  concurrency?: number;
}

export interface EnqueueInput {
  projectId: string;
  generatorId: string;
  profileId: string;
  /**
   * Generator-specific options. Threaded into GeneratorContext.options.
   * full-tree-spec honors `itemIds: string[]` (only enrich those items).
   * enrich-items honors `itemIds: string[]` + `force: boolean`.
   */
  options?: Record<string, unknown>;
}

/**
 * Fired once per run after its terminal status has been written. Listeners
 * receive the final status + summary so they can chain follow-up work without
 * subscribing to the per-run event broker.
 *
 * Used by serve.ts to auto-enqueue an enrichment-pipeline run after a
 * successful initial parse (Task 9 of the AI enrichment pipeline plan).
 */
export interface RunCompletedEvent {
  runId: string;
  projectId: string;
  generatorId: string;
  profileId: string;
  status: "success" | "failed" | "cancelled";
  summary: RunSummary;
  options?: Record<string, unknown>;
}

export class RunWorker {
  private readonly queue: PQueue;
  private readonly cancellations = new Set<string>();
  private readonly emitter = new EventEmitter();

  constructor(
    private readonly deps: RunWorkerDeps,
    opts: RunWorkerOptions = {},
  ) {
    this.queue = new PQueue({ concurrency: opts.concurrency ?? 1 });
    // Listeners are typically wired once at boot for post-run chaining (e.g.
    // auto-enqueueing the enrichment-pipeline after initial parses). Default
    // is 10, which is plenty, but we raise it slightly to keep parity with
    // RunEventBroker's per-run emitter and leave headroom.
    this.emitter.setMaxListeners(50);
  }

  /**
   * Subscribe to terminal-status events for ALL runs handled by this worker.
   * Listener receives the runId, projectId, generatorId, final status, and
   * summary. Returns an unsubscribe function. Listeners must be defensive —
   * they run on the worker's executeRun continuation and any throw they
   * produce is swallowed (logged to stderr) so as not to crash the worker.
   */
  onRunCompleted(listener: (e: RunCompletedEvent) => void): () => void {
    this.emitter.on("runCompleted", listener);
    return () => this.emitter.off("runCompleted", listener);
  }

  enqueue(input: EnqueueInput): string {
    const run = this.deps.runs.create(input);
    void this.queue.add(() => this.executeRun(run.id, input));
    return run.id;
  }

  /**
   * Best-effort cancellation. Returns true if the run was queued/running.
   *
   * Only flips the in-memory cancellation flag — executeRun's finally block
   * owns the DB status transition so we don't flicker (running → cancelled →
   * success) when a cancel races a final yield. Queued runs that never start
   * are short-circuited by executeRun's pre-check, leaving them at "queued"
   * with no startedAt; the boot-time markInterruptedOnBoot path will not flip
   * those because the cancellation flag is in-memory only, so we set the
   * status here for runs that haven't been picked up yet.
   */
  cancel(runId: string): boolean {
    const r = this.deps.runs.findById(runId);
    if (!r) return false;
    if (r.status !== "queued" && r.status !== "running") return false;

    this.cancellations.add(runId);

    // Queued-but-not-started runs need an explicit status flip; executeRun's
    // pre-check returns without writing anything in that case.
    if (r.status === "queued" && r.started_at === null) {
      this.deps.runs.updateStatus(runId, "cancelled", {
        finishedAt: new Date().toISOString(),
      });
    }
    return true;
  }

  private async executeRun(runId: string, input: EnqueueInput): Promise<void> {
    // Cancellation can happen before the queue picks the task up
    if (this.cancellations.has(runId)) {
      this.cancellations.delete(runId);
      return;
    }

    const startedAt = new Date().toISOString();
    const logPath = await this.deps.broker.open(runId);
    this.deps.runs.updateStatus(runId, "running", { startedAt, logPath });

    let summary: RunSummary = emptyRunSummary();
    let lastEvent: RunEvent | undefined;

    try {
      const project = this.deps.projects.findById(input.projectId);
      if (!project) throw new Error(`Project not found: ${input.projectId}`);

      let parserFs: ParserFileSystem;
      // Where ProfileLoader looks for project-local profile overrides. For
      // local projects this is the source root; for github projects there's
      // no on-disk source root, so we fall back to the project's data dir
      // (which is where we'd write any overrides anyway).
      let profileSearchDir: string;
      // Where the AI source-reader looks up SpecItem.sourceFiles on disk.
      // Local: same as the parser root. GitHub: undefined — the generator
      // skips disk reads entirely and the AI runs with the structured Item
      // JSON alone (still meaningful, just less context).
      let sourceRootDir: string | undefined;
      if (project.source.type === "local") {
        parserFs = new LocalFs(project.source.localPath);
        profileSearchDir = project.source.localPath;
        sourceRootDir = project.source.localPath;
      } else if (project.source.type === "github") {
        if (!this.deps.tokens) {
          throw new Error("GitHub source requires a TokenStore to be wired into RunWorkerDeps");
        }
        parserFs = await buildGitHubFs({
          project,
          tokens: this.deps.tokens,
          onWarning: (message) => this.deps.broker.emit(runId, { type: "warning", message }),
        });
        profileSearchDir = getProjectDataDir(project);
      } else {
        throw new Error(`Unsupported source.type: ${(project.source as { type: string }).type}`);
      }

      const profileLoader = new ProfileLoader({
        packagedRoot: this.deps.packagedProfilesDir,
      });
      const profile = await profileLoader.load(input.profileId, profileSearchDir);

      const generator = this.deps.generatorRegistry.get(input.generatorId);
      if (!generator) throw new Error(`Unknown generator: ${input.generatorId}`);

      const projectAi = project.ai;
      const ai = projectAi.provider
        ? buildAiRouter(projectAi)
        : new AiRouter({ primary: new LocalClient() });

      const dataDir = getProjectDataDir(project);
      const spec = new JsonSpecRepository(dataDir);

      const aiOverrides = {
        model: typeof projectAi.model === "string" ? projectAi.model : undefined,
        temperature: typeof projectAi.temperature === "number" ? projectAi.temperature : undefined,
        maxTokens: typeof projectAi.maxTokens === "number" ? projectAi.maxTokens : undefined,
        concurrency: typeof projectAi.concurrency === "number" ? projectAi.concurrency : undefined,
      };

      // Thread project.parserConfig.parserMode into generator options so
      // full-tree-spec's parser-dispatch block can branch on it. Falls back
      // to "rule-only" when the project hasn't opted in.
      const parserModeRaw = (project.parserConfig as Record<string, unknown> | undefined)
        ?.parserMode;
      const parserMode =
        parserModeRaw === "rule-plus-llm-fallback" ||
        parserModeRaw === "llm-only" ||
        parserModeRaw === "rule-only"
          ? parserModeRaw
          : "rule-only";
      const mergedOptions = { ...(input.options ?? {}), parserMode };

      for await (const event of generator.run({
        rootDir: parserFs.rootDir,
        sourceRootDir,
        fs: parserFs,
        profile,
        parsers: this.deps.parserRegistry,
        spec,
        ai,
        guidelines: (projectAi.guidelines as string | undefined) ?? undefined,
        aiOverrides,
        options: mergedOptions,
      })) {
        if (this.cancellations.has(runId)) {
          this.deps.broker.emit(runId, {
            type: "warning",
            message: "Run cancelled by user",
          });
          break;
        }
        this.deps.broker.emit(runId, event);
        lastEvent = event;
        if (event.type === "done") {
          summary = event.stats;
        }
      }

      const finishedAt = new Date().toISOString();
      const cancelled = this.cancellations.has(runId);
      this.cancellations.delete(runId);

      let finalStatus: "cancelled" | "failed" | "success";
      if (cancelled) {
        finalStatus = "cancelled";
      } else if (lastEvent?.type === "error") {
        finalStatus = "failed";
      } else {
        finalStatus = "success";
      }

      this.deps.runs.updateStats(runId, summary);
      this.deps.runs.updateStatus(runId, finalStatus, {
        finishedAt,
        errorText:
          lastEvent?.type === "error" ? ((lastEvent.error as Error).message ?? null) : undefined,
      });

      this.fireRunCompleted({
        runId,
        projectId: input.projectId,
        generatorId: input.generatorId,
        profileId: input.profileId,
        status: finalStatus,
        summary,
        options: input.options,
      });
    } catch (err) {
      const finishedAt = new Date().toISOString();
      const errorMessage = (err as Error).message;
      // Emit error so subscribers see it (broker is already open at this point)
      try {
        this.deps.broker.emit(runId, { type: "error", error: err as Error });
      } catch {
        // Broker may have been closed in some failure paths; tolerate
      }
      this.cancellations.delete(runId);
      this.deps.runs.updateStatus(runId, "failed", {
        finishedAt,
        errorText: errorMessage,
      });

      this.fireRunCompleted({
        runId,
        projectId: input.projectId,
        generatorId: input.generatorId,
        profileId: input.profileId,
        status: "failed",
        summary,
        options: input.options,
      });
    } finally {
      await this.deps.broker.close(runId);
    }
  }

  /**
   * Emit runCompleted to subscribers. Listener exceptions are caught so a
   * misbehaving subscriber can't break the worker loop or mask the run's
   * real status. We log to stderr so the failure is still visible.
   */
  private fireRunCompleted(event: RunCompletedEvent): void {
    try {
      this.emitter.emit("runCompleted", event);
    } catch (err) {
      process.stderr.write(`[RunWorker] runCompleted listener threw: ${(err as Error).message}\n`);
    }
  }
}
