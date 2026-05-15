import { ConfluenceClient, ConfluencePushService } from "@specgen/connector-confluence";
import { Router } from "express";
import { httpError } from "../middleware/errorHandler.js";
import { validateSlug } from "../middleware/validateSlug.js";
import type { ConfluencePageMapRepository } from "../repositories/ConfluencePageMapRepository.js";
import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import type { RunWorker } from "../services/RunWorker.js";
import type { TokenStore } from "../services/TokenStore.js";

interface ConfluenceConnectorCfg {
  spaceKey: string;
  parentPageId?: string;
}

function readConfluenceConfig(connectors: Record<string, unknown>): ConfluenceConnectorCfg | null {
  const raw = (connectors as { confluence?: ConfluenceConnectorCfg }).confluence;
  if (!raw || typeof raw !== "object" || typeof raw.spaceKey !== "string") {
    return null;
  }
  return raw;
}

/**
 * REST surface for the Confluence push connector (Task F.8).
 * Mounted under `/api/v0/projects` per PD3 (Phase D version-locked prefix).
 *
 *   POST /api/v0/projects/:slug/confluence/test   → ping space + auth (synchronous)
 *   POST /api/v0/projects/:slug/confluence/push   → enqueue streaming RunWorker run, returns 202 { runId }
 *   GET  /api/v0/projects/:slug/confluence/state  → page-map summary
 *
 * The push route was previously synchronous (held the request open for the
 * duration of the push, which could be 30-60s for ~30 pages). It now
 * enqueues a `confluence-push` generator run and returns the runId so the
 * webapp can tail it via the standard SSE + ProgressDrawer pipeline. See
 * `core/src/generator/builtins/confluence-push.ts` for the streaming wrapper.
 */
export function confluenceRouter(deps: {
  projects: SqliteProjectRepository;
  confluencePageMap: ConfluencePageMapRepository;
  tokens: TokenStore;
  worker: RunWorker;
}): Router {
  const r = Router({ mergeParams: true });

  r.post("/:slug/confluence/test", validateSlug("slug"), async (req, res, next) => {
    try {
      const project = deps.projects.findBySlug(req.params.slug as string);
      if (!project) return next(httpError(404, "Project not found"));

      const cfg = readConfluenceConfig(project.connectors);
      if (!cfg) {
        return next(
          httpError(
            400,
            "Confluence connector not configured (set connectors.confluence.spaceKey)",
          ),
        );
      }

      const tokenValue = await deps.tokens.get({
        projectId: project.id,
        provider: "confluence",
      });
      if (!tokenValue || tokenValue.provider !== "confluence") {
        return next(httpError(400, "Confluence token required"));
      }

      const client = new ConfluenceClient({
        baseUrl: tokenValue.baseUrl,
        email: tokenValue.email,
        apiToken: tokenValue.apiToken,
      });
      const space = await client.findSpace(cfg.spaceKey);
      res.json({ ok: true, space });
    } catch (err) {
      // Surface Confluence error messages directly — they include status code
      // and response body, which is what the UI wants to display.
      next(httpError(400, (err as Error).message));
    }
  });

  r.post("/:slug/confluence/push", validateSlug("slug"), async (req, res, next) => {
    try {
      const project = deps.projects.findBySlug(req.params.slug as string);
      if (!project) return next(httpError(404, "Project not found"));

      const cfg = readConfluenceConfig(project.connectors);
      if (!cfg) {
        return next(
          httpError(
            400,
            "Confluence connector not configured (set connectors.confluence.spaceKey)",
          ),
        );
      }

      const tokenValue = await deps.tokens.get({
        projectId: project.id,
        provider: "confluence",
      });
      if (!tokenValue || tokenValue.provider !== "confluence") {
        return next(httpError(400, "Confluence token required"));
      }

      // Build the push service eagerly so we can fail fast with 4xx if
      // credentials / config are missing. The service instance is then
      // handed to the generator via the run's options map — generator
      // options are passed in-process so a class instance is fine.
      //
      // RunWorker's per-project concurrency = 1 (single queue) makes a
      // dedicated in-flight mutex unnecessary: a second POST simply enqueues
      // another run that drains after the first.
      const client = new ConfluenceClient({
        baseUrl: tokenValue.baseUrl,
        email: tokenValue.email,
        apiToken: tokenValue.apiToken,
      });
      const pushService = new ConfluencePushService(client, deps.confluencePageMap);

      const profileId = (project.ai as { profileId?: string } | undefined)?.profileId ?? "pm-spec";

      const runId = deps.worker.enqueue({
        projectId: project.id,
        generatorId: "confluence-push",
        profileId,
        options: {
          confluencePushService: pushService,
          projectId: project.id,
          spaceKey: cfg.spaceKey,
          parentPageId: cfg.parentPageId,
        },
      });

      res.status(202).json({ runId, status: "queued" });
    } catch (err) {
      next(err);
    }
  });

  r.get("/:slug/confluence/state", validateSlug("slug"), (req, res, next) => {
    try {
      const project = deps.projects.findBySlug(req.params.slug as string);
      if (!project) return next(httpError(404, "Project not found"));
      const rows = deps.confluencePageMap.listByProject(project.id);
      const live = rows.filter((row) => !row.tombstoned_at);
      const tombstoned = rows.filter((row) => row.tombstoned_at);
      // Last sync = max(last_synced_at) across live + tombstoned.
      const lastSynced = rows.reduce<string | null>((acc, row) => {
        if (!acc) return row.last_synced_at;
        return row.last_synced_at > acc ? row.last_synced_at : acc;
      }, null);
      res.json({
        live: live.length,
        tombstoned: tombstoned.length,
        lastSyncedAt: lastSynced,
        pages: rows,
      });
    } catch (err) {
      next(err as Error);
    }
  });

  return r;
}
