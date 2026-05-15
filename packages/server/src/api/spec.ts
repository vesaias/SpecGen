import { JsonSpecRepository } from "@specgen/core";
import { Router } from "express";
import { httpError } from "../middleware/errorHandler.js";
import { validateSlug } from "../middleware/validateSlug.js";
import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import { getProjectDataDir } from "../services/projectDataDir.js";

const MAX_VERSIONS = 10;

/** Item file shape as stored on disk (superset of SpecItem). */
interface ItemFile {
  id: string;
  type: string;
  title: string;
  blocks?: unknown[];
  spec?: Record<string, unknown>;
  version?: number;
  lastModified?: string;
  modifiedBy?: string;
  versions?: VersionSnapshot[];
  [key: string]: unknown;
}

interface VersionSnapshot {
  version: number;
  at: string;
  by: string;
  changes: string;
  blocks: unknown[];
}

function summarizeChanges(updates: Record<string, unknown>): string {
  const parts: string[] = [];
  if (updates.blocks) parts.push("blocks edited");
  for (const key of Object.keys(updates)) {
    if (key !== "blocks") {
      parts.push(`${key} updated`);
    }
  }
  return parts.join(", ") || "updated";
}

export function specRouter(projects: SqliteProjectRepository): Router {
  const r = Router({ mergeParams: true });

  /** Resolve project + repo for the current :slug. Throws httpError if not found. */
  async function resolveRepo(slug: string) {
    const project = projects.findBySlug(slug);
    if (!project) throw httpError(404, "Project not found");
    const dataDir = getProjectDataDir(project);
    const repo = new JsonSpecRepository(dataDir);
    return { project, repo };
  }

  // ---------------------------------------------------------------------------
  // GET /api/projects/:slug/spec
  // Returns spec index (meta + tree) merged with all items
  // ---------------------------------------------------------------------------
  r.get("/", validateSlug("slug"), async (req, res, next) => {
    try {
      const { repo } = await resolveRepo(req.params.slug as string);
      const spec = await repo.read();
      if (!spec)
        return next(
          httpError(
            404,
            "Spec not found — click Update in the project topbar to parse this project.",
          ),
        );

      const ids = await repo.listItemIds();
      const items: Record<string, unknown> = {};
      for (const id of ids) {
        const item = (await repo.readItem(id)) as ItemFile | null;
        if (item) items[id] = item;
      }

      res.json({ ...spec, items });
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/projects/:slug/spec/tree
  // Replaces the spec tree (e.g. after a sidebar drag/folder rename).
  // ---------------------------------------------------------------------------
  r.patch("/tree", validateSlug("slug"), async (req, res, next) => {
    try {
      const { repo } = await resolveRepo(req.params.slug as string);
      const body = req.body as { tree?: unknown };
      if (!Array.isArray(body.tree)) {
        return next(httpError(400, "Body must include a `tree` array"));
      }
      const current = await repo.read();
      if (!current) return next(httpError(404, "Spec not found"));
      await repo.write({ ...current, tree: body.tree as any });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/projects/:slug/spec/item/:id
  // ---------------------------------------------------------------------------
  r.get("/item/:id", validateSlug("slug"), async (req, res, next) => {
    try {
      const { repo } = await resolveRepo(req.params.slug as string);
      const item = await repo.readItem(req.params.id as string);
      if (!item) return next(httpError(404, `Item ${req.params.id} not found`));
      res.json(item);
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------------------
  // PATCH /api/projects/:slug/spec/item/:id
  // Updates an item; pushes a new version snapshot before applying changes.
  // ---------------------------------------------------------------------------
  r.patch("/item/:id", validateSlug("slug"), async (req, res, next) => {
    try {
      const { repo } = await resolveRepo(req.params.slug as string);
      const itemFile = (await repo.readItem(req.params.id as string)) as ItemFile | null;
      if (!itemFile) return next(httpError(404, `Item ${req.params.id} not found`));

      const updates = req.body as Record<string, unknown>;

      const hasBlocksChange =
        updates.blocks && JSON.stringify(updates.blocks) !== JSON.stringify(itemFile.blocks);
      const hasSpecChange = Object.keys(updates).some((k) => k !== "blocks");

      if (hasBlocksChange || hasSpecChange) {
        const snapshot: VersionSnapshot = {
          version: itemFile.version ?? 1,
          at: itemFile.lastModified ?? new Date().toISOString(),
          by: itemFile.modifiedBy ?? "user",
          changes: summarizeChanges(updates),
          blocks: (itemFile.blocks ?? []) as unknown[],
        };
        if (!itemFile.versions) itemFile.versions = [];
        itemFile.versions.unshift(snapshot);
        if (itemFile.versions.length > MAX_VERSIONS) {
          itemFile.versions = itemFile.versions.slice(0, MAX_VERSIONS);
        }
        itemFile.version = (itemFile.version ?? 1) + 1;
      }

      // Apply updates
      if (updates.blocks !== undefined) itemFile.blocks = updates.blocks as unknown[];

      // Update spec sub-fields
      for (const [key, val] of Object.entries(updates)) {
        if (
          key !== "blocks" &&
          key !== "_version" &&
          key !== "_lastModified" &&
          key !== "_modifiedBy"
        ) {
          if (!itemFile.spec) itemFile.spec = {};
          itemFile.spec[key] = val;
        }
      }

      itemFile.lastModified = new Date().toISOString();
      itemFile.modifiedBy = "user";
      await repo.writeItem(itemFile as any);
      res.json({ ok: true, version: itemFile.version });
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/projects/:slug/spec/item/:id/versions
  // ---------------------------------------------------------------------------
  r.get("/item/:id/versions", validateSlug("slug"), async (req, res, next) => {
    try {
      const { repo } = await resolveRepo(req.params.slug as string);
      const itemFile = (await repo.readItem(req.params.id as string)) as ItemFile | null;
      if (!itemFile) return next(httpError(404, "Item not found"));

      const history = (itemFile.versions ?? []).map((v) => ({
        version: v.version,
        at: v.at,
        by: v.by,
        changes: v.changes,
      }));

      // Prepend current as first entry
      history.unshift({
        version: itemFile.version ?? 1,
        at: itemFile.lastModified ?? "",
        by: itemFile.modifiedBy ?? "user",
        changes: "current",
      });

      res.json(history);
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/projects/:slug/spec/item/:id/version/:v
  // ---------------------------------------------------------------------------
  r.get("/item/:id/version/:v", validateSlug("slug"), async (req, res, next) => {
    try {
      const { repo } = await resolveRepo(req.params.slug as string);
      const itemFile = (await repo.readItem(req.params.id as string)) as ItemFile | null;
      if (!itemFile) return next(httpError(404, "Item not found"));

      const v = Number.parseInt(req.params.v as string, 10);
      if (Number.isNaN(v)) return next(httpError(400, "version must be an integer"));

      if (v === (itemFile.version ?? 1)) {
        return res.json({ version: itemFile.version, blocks: itemFile.blocks });
      }

      const found = (itemFile.versions ?? []).find((ver) => ver.version === v);
      if (!found) return next(httpError(404, `Version ${v} not found`));
      res.json({ version: found.version, blocks: found.blocks, at: found.at, by: found.by });
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/projects/:slug/spec/item/:id/restore/:v
  // ---------------------------------------------------------------------------
  r.post("/item/:id/restore/:v", validateSlug("slug"), async (req, res, next) => {
    try {
      const { repo } = await resolveRepo(req.params.slug as string);
      const itemFile = (await repo.readItem(req.params.id as string)) as ItemFile | null;
      if (!itemFile) return next(httpError(404, "Item not found"));

      const v = Number.parseInt(req.params.v as string, 10);
      if (Number.isNaN(v)) return next(httpError(400, "version must be an integer"));

      const found = (itemFile.versions ?? []).find((ver) => ver.version === v);
      if (!found) return next(httpError(404, `Version ${v} not found`));

      // Save current as a version snapshot
      if (!itemFile.versions) itemFile.versions = [];
      itemFile.versions.unshift({
        version: itemFile.version ?? 1,
        at: itemFile.lastModified ?? new Date().toISOString(),
        by: itemFile.modifiedBy ?? "user",
        changes: "before restore",
        blocks: (itemFile.blocks ?? []) as unknown[],
      });
      if (itemFile.versions.length > MAX_VERSIONS) {
        itemFile.versions = itemFile.versions.slice(0, MAX_VERSIONS);
      }

      // Restore
      itemFile.blocks = found.blocks;
      itemFile.version = (itemFile.version ?? 1) + 1;
      itemFile.lastModified = new Date().toISOString();
      itemFile.modifiedBy = "user";
      await repo.writeItem(itemFile as any);
      res.json({ ok: true, version: itemFile.version });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
