import { mkdtempSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GitHubBlobCache, GitHubFs } from "@specgen/core";
import type { Project } from "../types/Project.js";
import type { TokenStore } from "./TokenStore.js";
import { getGitHubCacheDir } from "./projectDataDir.js";

/**
 * Build a `GitHubFs` for a GitHub-source project. Pulls the project's GitHub
 * token out of the encrypted `TokenStore`; throws if none is configured (the
 * UI Settings → Tokens flow is the operator's way in).
 *
 * `onWarning` is wired to the caller so rate-limit + LFS warnings surface in
 * the run event stream.
 */
export interface BuildGitHubFsOpts {
  project: Project;
  tokens: TokenStore;
  onWarning?: (msg: string) => void;
}

export async function buildGitHubFs(opts: BuildGitHubFsOpts): Promise<GitHubFs> {
  const { project, tokens, onWarning } = opts;
  if (project.source.type !== "github") {
    throw new Error(`buildGitHubFs: project source.type is "${project.source.type}", not "github"`);
  }
  const token = await tokens.get({ projectId: project.id, provider: "github" });
  if (!token) {
    throw new Error("GitHub source requires a github token — configure one in Settings → Tokens");
  }
  if (token.provider !== "github") {
    throw new Error(`Expected github token, got ${token.provider}`);
  }

  const cacheDir = getGitHubCacheDir(project.id);
  await fs.mkdir(cacheDir, { recursive: true });
  const cache = new GitHubBlobCache(cacheDir);

  return new GitHubFs({
    owner: project.source.owner,
    repo: project.source.repo,
    ref: project.source.ref ?? "main",
    token: token.token,
    cache,
    onWarning,
  });
}

/**
 * Build a `GitHubFs` from a raw token (no project or TokenStore required).
 * Used by the probe endpoint where the project doesn't exist yet and the PAT
 * comes directly from the request body.
 *
 * The cache is placed in a per-request OS tmp directory — probe is read-only
 * and ephemeral, so a persistent cache dir is not needed.
 */
export function buildGitHubFsFromCreds(cfg: {
  owner: string;
  repo: string;
  ref: string;
  token: string;
}): GitHubFs {
  const cacheDir = mkdtempSync(path.join(tmpdir(), "specgen-probe-"));
  const cache = new GitHubBlobCache(cacheDir);
  return new GitHubFs({ ...cfg, cache });
}
