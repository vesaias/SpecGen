import type { GeneratorRegistry, RunEvent } from "@specgen/core";
import { Router } from "express";
import { httpError } from "../middleware/errorHandler.js";
import { validateSlug } from "../middleware/validateSlug.js";
import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import type { RunRow, SqliteRunRepository } from "../repositories/SqliteRunRepository.js";
import type { RunEventBroker, SeqRunEvent } from "../services/RunEventBroker.js";
import type { RunWorker } from "../services/RunWorker.js";
import { generatorRequiresAi, isAiConfigured } from "../services/aiUsable.js";

export interface RunsRouterDeps {
  projects: SqliteProjectRepository;
  runs: SqliteRunRepository;
  worker: RunWorker;
  broker: RunEventBroker;
  /**
   * Optional generator registry — when provided, each run row in the
   * response gets a `generator_name` field (the GeneratorPlugin's `name`).
   * The webapp's Run history table prefers this over the raw `generator_id`.
   * Resolved at response time rather than persisted on the row so a
   * generator can be renamed without backfilling.
   */
  generators?: GeneratorRegistry;
}

export interface TopLevelRunsRouterDeps {
  runs: SqliteRunRepository;
  broker: RunEventBroker;
  worker: RunWorker;
  /** See `RunsRouterDeps.generators` — same semantics, applied to the by-id lookup. */
  generators?: GeneratorRegistry;
}

/**
 * Augment a run row with the generator's display `name` (looked up at
 * response time via the registry). Returns the row verbatim when no
 * registry is supplied or the generator is unknown.
 */
function withGeneratorName(
  row: RunRow,
  generators?: GeneratorRegistry,
): RunRow & { generator_name?: string } {
  const plugin = generators?.get(row.generator_id);
  return plugin ? { ...row, generator_name: plugin.name } : row;
}

/**
 * Project-scoped run endpoints. Mounted at /api/projects.
 *   POST /:slug/runs    enqueue a new run for a project
 *   GET  /:slug/runs    list runs for a project (newest first)
 */
export function projectRunsRouter(deps: RunsRouterDeps): Router {
  const r = Router({ mergeParams: true });

  r.post("/:slug/runs", validateSlug("slug"), (req, res, next) => {
    try {
      const slug = req.params.slug as string;
      const project = deps.projects.findBySlug(slug);
      if (!project) {
        next(httpError(404, "Project not found"));
        return;
      }

      const body = (req.body ?? {}) as {
        generator?: string;
        profile?: string;
        options?: Record<string, unknown>;
      };
      const generatorId = body.generator ?? "full-tree-spec";
      const profileId =
        body.profile ?? (project.ai as { profileId?: string } | undefined)?.profileId ?? "pm-spec";

      // Block AI-requiring generators when the project has no usable
      // provider — otherwise the run silently falls through to the local
      // stub provider and burns a full cycle into unusable output.
      // Non-AI generators (frontend-capture, future pure-data ones) still
      // pass through.
      if (generatorRequiresAi(generatorId) && !isAiConfigured(project)) {
        res.status(400).json({
          error: "AI provider not configured",
          hint: "Open Project → Settings → AI and pick a provider.",
        });
        return;
      }

      const runId = deps.worker.enqueue({
        projectId: project.id,
        generatorId,
        profileId,
        options: body.options,
      });
      res.status(201).json({ runId, status: "queued" });
    } catch (err) {
      next(err);
    }
  });

  r.get("/:slug/runs", validateSlug("slug"), (req, res, next) => {
    try {
      const slug = req.params.slug as string;
      const project = deps.projects.findBySlug(slug);
      if (!project) {
        next(httpError(404, "Project not found"));
        return;
      }
      const rows = deps.runs.listByProjectId(project.id);
      res.json(rows.map((r) => withGeneratorName(r, deps.generators)));
    } catch (err) {
      next(err);
    }
  });

  return r;
}

/**
 * Top-level run endpoints (not project-scoped). Mounted at /api/runs.
 *   GET /:id         look up a single run by id
 *   GET /:id/events  SSE stream — replays past events, then streams live events
 *   POST /:id/cancel cancel a queued/running run
 *   DELETE /:id      delete a finished run
 */
export function runsRouter(deps: TopLevelRunsRouterDeps): Router {
  const r = Router();

  r.get("/:id", (req, res, next) => {
    try {
      const id = req.params.id as string;
      const run = deps.runs.findById(id);
      if (!run) {
        next(httpError(404, "Run not found"));
        return;
      }
      res.json(withGeneratorName(run, deps.generators));
    } catch (err) {
      next(err);
    }
  });

  r.get("/:id/events", (req, res, next) => {
    const id = req.params.id as string;
    const run = deps.runs.findById(id);
    if (!run) {
      next(httpError(404, "Run not found"));
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (event: RunEvent): void => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    // Subscribe FIRST so we don't lose events emitted while the disk replay
    // is in flight. Buffer live events until replay finishes, then drain the
    // buffer dropping any whose `seq` already appeared on disk.
    let lastReplaySeq = 0;
    let bufferingDone = false;
    const buffered: SeqRunEvent[] = [];

    const unsubscribe = deps.broker.subscribe(id, (wrapped) => {
      if (!bufferingDone) {
        buffered.push(wrapped);
        return;
      }
      if (wrapped.seq > lastReplaySeq) send(wrapped.event);
    });

    let closed = false;
    req.on("close", () => {
      closed = true;
      unsubscribe();
      res.end();
    });

    (async () => {
      for await (const wrapped of deps.broker.replay(id)) {
        if (closed) return;
        send(wrapped.event);
        if (wrapped.seq > lastReplaySeq) lastReplaySeq = wrapped.seq;
      }

      bufferingDone = true;
      for (const wrapped of buffered) {
        if (closed) return;
        if (wrapped.seq > lastReplaySeq) send(wrapped.event);
      }
      buffered.length = 0;

      if (!deps.broker.isOpen(id) && !closed) {
        unsubscribe();
        res.end();
      }
    })().catch((err) => {
      unsubscribe();
      next(err);
    });
  });

  r.post("/:id/cancel", (req, res, next) => {
    try {
      const id = req.params.id as string;
      const ok = deps.worker.cancel(id);
      if (!ok) {
        next(httpError(404, "Run not found or not cancellable"));
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  r.delete("/:id", (req, res, next) => {
    try {
      const id = req.params.id as string;
      const run = deps.runs.findById(id);
      if (!run) {
        next(httpError(404, "Run not found"));
        return;
      }
      deps.runs.delete(id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return r;
}
