import { JsonSpecRepository } from "@specgen/core";
import { Router } from "express";
import { httpError } from "../middleware/errorHandler.js";
import { validateSlug } from "../middleware/validateSlug.js";
import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import type { RunWorker } from "../services/RunWorker.js";
import { getProjectDataDir } from "../services/projectDataDir.js";

export interface ItemsRouterDeps {
  projects: SqliteProjectRepository;
  worker: RunWorker;
}

/**
 * Project-scoped item endpoints. Mounted at `/api/v0/projects`.
 *
 *   POST /:slug/items/:itemId/enrich  enqueue a single-item enrichment run
 *
 * Routed through the `enrich-items` generator with itemIds=[itemId]. That
 * generator reads the named item, runs AI in-place, and writes it back —
 * with NO re-parse, NO tree changes, NO smart-tree reorganization. This is
 * critical when parser-llm is in play: routing single-item re-enrichment
 * through `enrichment-pipeline` (full-tree-spec under the hood) would
 * re-parse the entire repo, and parser-llm's per-file non-determinism
 * would delete + recreate sibling items every time the user clicked
 * "Re-enrich" on one page.
 */
export function itemsRouter(deps: ItemsRouterDeps): Router {
  const r = Router({ mergeParams: true });

  r.post("/:slug/items/:itemId/enrich", validateSlug("slug"), async (req, res, next) => {
    try {
      const slug = req.params.slug as string;
      const itemId = req.params.itemId as string;

      const project = deps.projects.findBySlug(slug);
      if (!project) {
        next(httpError(404, "Project not found"));
        return;
      }

      // Item ids must match the same shape JsonSpecRepository accepts; reject
      // anything that would otherwise throw inside readItem (path traversal,
      // invalid characters) with a 404 since "no such item" is the correct
      // surface from the caller's perspective.
      if (!/^[a-z0-9][a-z0-9-]*$/.test(itemId)) {
        next(httpError(404, `Item ${itemId} not found`));
        return;
      }

      const dataDir = getProjectDataDir(project);
      const spec = new JsonSpecRepository(dataDir);
      const item = await spec.readItem(itemId);
      if (!item) {
        next(httpError(404, `Item ${itemId} not found`));
        return;
      }

      const profileId = (project.ai as { profileId?: string } | undefined)?.profileId ?? "pm-spec";

      const runId = deps.worker.enqueue({
        projectId: project.id,
        generatorId: "enrich-items",
        profileId,
        // force=true so the AI runs even if drift hashes match — the user
        // clicked "Re-enrich" precisely because they want a fresh AI pass.
        options: { itemIds: [itemId], force: true },
      });
      res.status(202).json({ runId });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
