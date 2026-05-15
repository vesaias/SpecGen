import { homedir } from "node:os";
import path from "node:path";
import type { Project } from "../types/Project.js";

/**
 * Resolve the absolute data directory for a project.
 *
 * Local projects:  <localPath>/.specgen/data
 * GitHub projects: <dbDir>/github-data/<projectId>
 *   (co-located with the SQLite DB so a single backup covers both)
 */
export function getProjectDataDir(project: Project): string {
  if (project.source.type === "local") {
    return path.join(project.source.localPath, ".specgen", "data");
  }
  if (project.source.type === "github") {
    return path.join(resolveSpecgenDataRoot(), "github-data", project.id);
  }
  throw new Error(
    `getProjectDataDir: source type "${(project.source as { type: string }).type}" not supported`,
  );
}

/**
 * Returns the directory holding cached GitHub trees + blobs for a project.
 * Mirrors `getProjectDataDir` — we keep cache + spec alongside the DB so that
 * a single data-volume backup captures everything for a project.
 */
export function getGitHubCacheDir(projectId: string): string {
  return path.join(resolveSpecgenDataRoot(), "github-cache", projectId);
}

/**
 * Returns the directory holding the persistent git clone for the Git /docs
 * push connector (Task D.6). Kept under the same data root as everything else
 * so a single backup covers it.
 */
export function getGitDocsCloneDir(projectId: string): string {
  return path.join(resolveSpecgenDataRoot(), "git-docs-clones", projectId);
}

/**
 * Where SpecGen's per-user data lives. Defaults to `~/.specgen/`, overridable
 * via SPECGEN_DB (we use its dirname). Kept private — callers should use the
 * specific getters above instead of building paths themselves.
 */
function resolveSpecgenDataRoot(): string {
  const dbPath = process.env.SPECGEN_DB ?? path.join(homedir(), ".specgen", "specgen.db");
  return path.dirname(dbPath);
}
