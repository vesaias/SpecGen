import { Router } from "express";
import { httpError } from "../middleware/errorHandler.js";
import { validateSlug } from "../middleware/validateSlug.js";
import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import type { TokenStore, TokenValue } from "../services/TokenStore.js";

const VALID_PROVIDERS = new Set(["github", "confluence", "capture-auth"]);

function validateProvider(p: string): string {
  if (!VALID_PROVIDERS.has(p)) throw httpError(400, `Unsupported provider: ${p}`);
  return p;
}

/**
 * REST surface for the encrypted token store (Phase D — Task D.2).
 * Mounted under `/api/v0/projects` per PD3 (Phase D version-locked prefix).
 *
 *   GET    /api/v0/projects/:slug/tokens              → redacted list
 *   PUT    /api/v0/projects/:slug/tokens/:provider    → upsert encrypted token
 *   DELETE /api/v0/projects/:slug/tokens/:provider    → remove token
 */
export function tokensRouter(deps: {
  projects: SqliteProjectRepository;
  tokens: TokenStore;
}): Router {
  const r = Router({ mergeParams: true });
  // requireSameOrigin is mounted globally in buildApp — no per-router use needed.

  r.get("/:slug/tokens", validateSlug("slug"), async (req, res, next) => {
    try {
      const project = deps.projects.findBySlug(req.params.slug as string);
      if (!project) return next(httpError(404, "Project not found"));
      res.json(await deps.tokens.list(project.id));
    } catch (err) {
      next(err);
    }
  });

  r.put("/:slug/tokens/:provider", validateSlug("slug"), async (req, res, next) => {
    try {
      const project = deps.projects.findBySlug(req.params.slug as string);
      if (!project) return next(httpError(404, "Project not found"));
      const provider = validateProvider(req.params.provider as string);
      const body = req.body as (TokenValue & { label?: string }) | undefined;
      if (!body || typeof body !== "object" || body.provider !== provider) {
        return next(httpError(400, "Body provider must match URL :provider"));
      }
      if (body.label !== undefined && (typeof body.label !== "string" || body.label.length > 200)) {
        return next(httpError(400, "label must be a string ≤ 200 chars"));
      }
      await deps.tokens.set({ projectId: project.id, provider }, body, body.label);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  r.delete("/:slug/tokens/:provider", validateSlug("slug"), async (req, res, next) => {
    try {
      const project = deps.projects.findBySlug(req.params.slug as string);
      if (!project) return next(httpError(404, "Project not found"));
      const provider = validateProvider(req.params.provider as string);
      const ok = await deps.tokens.delete({
        projectId: project.id,
        provider,
      });
      res.status(ok ? 204 : 404).end();
    } catch (err) {
      next(err);
    }
  });

  return r;
}
