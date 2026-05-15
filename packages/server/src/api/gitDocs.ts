import { Router } from "express";
import { httpError } from "../middleware/errorHandler.js";
import { validateSlug } from "../middleware/validateSlug.js";
import type { GitDocsStateRepository } from "../repositories/GitDocsStateRepository.js";
import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import type { TokenStore } from "../services/TokenStore.js";
import {
  DocsPushConflictError,
  GitDocsPushBusyError,
  readGitDocsConfig,
  runGitDocsPush,
} from "../services/gitDocsPush.js";

/**
 * REST surface for the Git /docs push connector (Task D.6).
 * Mounted under `/api/v0/projects` per PD3 (Phase D version-locked prefix).
 *
 *   POST /api/v0/projects/:slug/git-docs/push   → trigger a push, returns SHA + counts
 *   GET  /api/v0/projects/:slug/git-docs/state  → last push metadata (or null)
 *
 * The actual push logic lives in `services/gitDocsPush.ts` so the auto-push
 * listener (`installAutoPushOnRunComplete`) can reuse it without going
 * through HTTP.
 */
export function gitDocsRouter(deps: {
  projects: SqliteProjectRepository;
  gitDocsState: GitDocsStateRepository;
  tokens: TokenStore;
}): Router {
  const r = Router({ mergeParams: true });
  // requireSameOrigin is mounted globally in buildApp — no per-router use needed.

  r.post("/:slug/git-docs/push", validateSlug("slug"), async (req, res, next) => {
    const project = deps.projects.findBySlug(req.params.slug as string);
    if (!project) return next(httpError(404, "Project not found"));

    // Eager 4xx checks: surface "not configured" / "token required" before we
    // claim the per-project mutex inside runGitDocsPush.
    const connectorCfg = readGitDocsConfig(project.connectors);
    if (!connectorCfg) {
      return next(
        httpError(400, "git-docs connector not configured (set connectors.gitDocs.cloneUrl)"),
      );
    }
    const tokenValue = await deps.tokens.get({ projectId: project.id, provider: "github" });
    if (!tokenValue || tokenValue.provider !== "github") {
      return next(httpError(400, "GitHub token required for git-docs push"));
    }

    try {
      const result = await runGitDocsPush({
        project,
        gitDocsState: deps.gitDocsState,
        tokens: deps.tokens,
      });
      res.json({
        ok: true,
        pushedSha: result.pushedSha,
        filesWritten: result.filesWritten,
      });
    } catch (err) {
      if (err instanceof GitDocsPushBusyError) {
        return next(httpError(409, err.message));
      }
      if (err instanceof DocsPushConflictError) {
        return next(httpError(409, err.message));
      }
      next(err as Error);
    }
  });

  r.get("/:slug/git-docs/state", validateSlug("slug"), (req, res, next) => {
    try {
      const project = deps.projects.findBySlug(req.params.slug as string);
      if (!project) return next(httpError(404, "Project not found"));
      const state = deps.gitDocsState.findByProjectId(project.id);
      res.json(state ?? null);
    } catch (err) {
      next(err as Error);
    }
  });

  return r;
}
