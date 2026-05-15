import { promises as fs } from "node:fs";
import path from "node:path";
import { ProfileLoader } from "@specgen/core";
import { Router } from "express";
import { httpError } from "../middleware/errorHandler.js";
import { validateSlug } from "../middleware/validateSlug.js";
import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import { validateProfileFilePath } from "../services/profileFileGuard.js";
import { isValidSlug } from "../services/slugify.js";

function validateProfileId(id: string): void {
  if (!isValidSlug(id)) {
    throw httpError(400, `Invalid profile id: ${id}`);
  }
}

export interface ProfileRouterDeps {
  projects: SqliteProjectRepository;
  packagedProfilesDir: string;
}

/**
 * Walk a profile directory and return the list of files (relative to the profile dir)
 * matching the allow-list.
 */
async function listProfileFiles(profileDir: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(rel: string): Promise<void> {
    const abs = path.join(profileDir, rel);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(r);
      } else {
        out.push(r);
      }
    }
  }
  await walk("");
  return out.sort();
}

function projectRootOrThrow(project: ReturnType<SqliteProjectRepository["findBySlug"]>): string {
  if (!project) throw httpError(404, "Project not found");
  if (project.source.type !== "local") {
    throw httpError(
      400,
      `Profile overrides require a local project (source.type=${project.source.type} not yet supported)`,
    );
  }
  return project.source.localPath;
}

function overrideDir(projectRoot: string, profileId: string): string {
  return path.join(projectRoot, ".specgen", "profiles", profileId);
}

/**
 * GET /api/profiles            list shipped profiles
 * GET /api/profiles/:id        manifest + files
 * GET /api/profiles/:id/file   read file (packaged unless override exists)
 *
 * Mounted at /api/profiles. Read-only.
 */
export function profilesRouter(deps: ProfileRouterDeps): Router {
  const r = Router();
  const loader = new ProfileLoader({ packagedRoot: deps.packagedProfilesDir });

  r.get("/", async (_req, res, next) => {
    try {
      const list = await loader.list();
      res.json(list);
    } catch (err) {
      next(err);
    }
  });

  r.get("/:id", async (req, res, next) => {
    try {
      const id = req.params.id as string;
      validateProfileId(id);
      try {
        const profile = await loader.load(id);
        const profileDir = path.join(deps.packagedProfilesDir, id);
        const files = await listProfileFiles(profileDir);
        res.json({ manifest: profile.manifest, files, inheritanceChain: profile.inheritanceChain });
      } catch (err) {
        if ((err as Error).message.includes("not found")) {
          return next(httpError(404, `Profile not found: ${id}`));
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  r.get("/:id/file", async (req, res, next) => {
    try {
      const id = req.params.id as string;
      validateProfileId(id);
      const relPath = req.query.path as string | undefined;
      validateProfileFilePath(relPath ?? "");

      const filePath = path.join(deps.packagedProfilesDir, id, relPath as string);
      try {
        const content = await fs.readFile(filePath, "utf8");
        res.type("text/plain").send(content);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return next(httpError(404, `File not found: ${relPath}`));
        }
        throw err;
      }
    } catch (err) {
      next(err);
    }
  });

  return r;
}

/**
 * Project-scoped profile override CRUD.
 * Mounted at /api/projects.
 */
export function projectProfilesRouter(deps: ProfileRouterDeps): Router {
  const r = Router({ mergeParams: true });

  // PATCH /:slug/profiles/:id/file?path=<rel>
  r.patch("/:slug/profiles/:id/file", validateSlug("slug"), async (req, res, next) => {
    try {
      const slug = req.params.slug as string;
      const id = req.params.id as string;
      validateProfileId(id);
      const relPath = req.query.path as string | undefined;
      validateProfileFilePath(relPath ?? "");

      const project = deps.projects.findBySlug(slug);
      const projectRoot = projectRootOrThrow(project);
      const dest = path.join(overrideDir(projectRoot, id), relPath as string);

      // Body is text/plain. Express text-body parser provides string; fall back to JSON shape.
      let content: string;
      if (typeof req.body === "string") {
        content = req.body;
      } else if (req.body && typeof (req.body as { content?: unknown }).content === "string") {
        content = (req.body as { content: string }).content;
      } else {
        return next(httpError(400, "Body must be text or { content: string }"));
      }

      await fs.mkdir(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.tmp`;
      await fs.writeFile(tmp, content, "utf8");
      await fs.rename(tmp, dest);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /:slug/profiles/:id/fork
  r.post("/:slug/profiles/:id/fork", validateSlug("slug"), async (req, res, next) => {
    try {
      const slug = req.params.slug as string;
      const id = req.params.id as string;
      validateProfileId(id);

      const project = deps.projects.findBySlug(slug);
      const projectRoot = projectRootOrThrow(project);
      const dir = overrideDir(projectRoot, id);
      const yamlPath = path.join(dir, "profile.yaml");

      try {
        await fs.access(yamlPath);
        return next(httpError(409, `Override profile already exists: ${id}`));
      } catch {
        // Doesn't exist — proceed
      }

      // Read the base profile's metadata for the fork header
      const loader = new ProfileLoader({ packagedRoot: deps.packagedProfilesDir });
      const base = await loader.load(id);
      const baseName = base.manifest.name;

      const forkYaml = [
        `# Project-level fork of '${id}' profile.`,
        "# Files in this directory override the packaged profile for this project.",
        "# See SpecGen profile docs for the inheritance / extends model.",
        "",
        "schemaVersion: 1",
        `id: ${id}`,
        `name: ${baseName} (project fork)`,
        "version: 0.1.0",
        `extends: ${id}`,
        `supports_generators: ${JSON.stringify(base.manifest.supports_generators)}`,
        `supports_item_types: ${JSON.stringify(base.manifest.supports_item_types)}`,
        "",
      ].join("\n");

      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(yamlPath, forkYaml, "utf8");
      res.status(201).json({ ok: true, path: yamlPath });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /:slug/profiles/:id/file?path=<rel>
  r.delete("/:slug/profiles/:id/file", validateSlug("slug"), async (req, res, next) => {
    try {
      const slug = req.params.slug as string;
      const id = req.params.id as string;
      validateProfileId(id);
      const relPath = req.query.path as string | undefined;
      validateProfileFilePath(relPath ?? "");

      const project = deps.projects.findBySlug(slug);
      const projectRoot = projectRootOrThrow(project);
      const filePath = path.join(overrideDir(projectRoot, id), relPath as string);

      try {
        await fs.unlink(filePath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // DELETE /:slug/profiles/:id
  r.delete("/:slug/profiles/:id", validateSlug("slug"), async (req, res, next) => {
    try {
      const slug = req.params.slug as string;
      const id = req.params.id as string;
      validateProfileId(id);

      const project = deps.projects.findBySlug(slug);
      const projectRoot = projectRootOrThrow(project);
      const dir = overrideDir(projectRoot, id);

      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return r;
}
