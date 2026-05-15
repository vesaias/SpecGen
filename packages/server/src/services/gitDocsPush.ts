/**
 * gitDocsPush — runtime wrapper around `DocsPushService.run()` that owns the
 * `gitDocsState` persistence, the in-flight mutex, and the runId convention.
 *
 * Extracted from `api/gitDocs.ts` so it can be reused by the auto-push
 * listener (`installAutoPushOnRunComplete`) without going through HTTP. The
 * REST handler at `POST /api/v0/projects/:slug/git-docs/push` is now a thin
 * shell around this function.
 *
 * Concurrency: a single shared `inflightPushes` map serialises pushes per
 * project. The map is process-local, which is what we want — RunWorker
 * concurrency=1 + this mutex together prevent `.git/index.lock` races inside
 * the shared clone dir regardless of whether the push was triggered by a
 * user click or by the auto-push listener.
 */

import { DocsPushConflictError, DocsPushService } from "@specgen/connector-git-docs";
import { JsonSpecRepository } from "@specgen/core";
import type { GitDocsStateRepository } from "../repositories/GitDocsStateRepository.js";
import type { Project } from "../types/Project.js";
import type { TokenStore } from "./TokenStore.js";
import { getGitDocsCloneDir, getProjectDataDir } from "./projectDataDir.js";
import { ulid } from "./ulid.js";

interface GitDocsConnectorCfg {
  cloneUrl: string;
  targetBranch?: string;
  docsRoot?: string;
  author?: { name: string; email: string };
  overwriteStrategy?: "force" | "halt";
}

export function readGitDocsConfig(connectors: Record<string, unknown>): GitDocsConnectorCfg | null {
  const raw = (connectors as { gitDocs?: GitDocsConnectorCfg }).gitDocs;
  if (!raw || typeof raw !== "object" || typeof raw.cloneUrl !== "string") {
    return null;
  }
  return raw;
}

/**
 * Per-project mutex keyed by project id. Shared between the REST route and
 * the auto-push listener so a manual click + an auto-trigger from an
 * enrichment run can't race on the same clone dir.
 */
const inflightPushes = new Map<string, Promise<RunGitDocsPushResult>>();

export interface RunGitDocsPushResult {
  pushedSha: string | null;
  filesWritten: number;
  runId: string;
}

export class GitDocsPushBusyError extends Error {
  constructor() {
    super("A push is already in progress for this project");
    this.name = "GitDocsPushBusyError";
  }
}

export interface RunGitDocsPushDeps {
  project: Project;
  gitDocsState: GitDocsStateRepository;
  tokens: TokenStore;
}

/**
 * Drive a single git-docs push for the given project. Returns the resulting
 * SHA + filesWritten count + the generated runId. Throws:
 *
 *   - `GitDocsPushBusyError` if another push is in flight for this project.
 *   - `Error("git-docs connector not configured")` if the project has no
 *     `connectors.gitDocs.cloneUrl`.
 *   - `Error("GitHub token required ...")` if no `github` token is stored.
 *   - `DocsPushConflictError` if the push hits the halt-strategy conflict gate.
 *   - whatever DocsPushService propagates for HTTP/git errors.
 *
 * The auto-push listener swallows all of these and writes to stderr — the
 * REST handler surfaces them as 4xx/5xx.
 */
export async function runGitDocsPush(deps: RunGitDocsPushDeps): Promise<RunGitDocsPushResult> {
  const { project, gitDocsState, tokens } = deps;

  const connectorCfg = readGitDocsConfig(project.connectors);
  if (!connectorCfg) {
    throw new Error("git-docs connector not configured (set connectors.gitDocs.cloneUrl)");
  }

  const tokenValue = await tokens.get({ projectId: project.id, provider: "github" });
  if (!tokenValue || tokenValue.provider !== "github") {
    throw new Error("GitHub token required for git-docs push");
  }

  if (inflightPushes.has(project.id)) {
    throw new GitDocsPushBusyError();
  }

  const runId = `git_${ulid()}`;
  const pushPromise = (async () => {
    const state = gitDocsState.findByProjectId(project.id);
    const repo = new JsonSpecRepository(getProjectDataDir(project));
    const cacheDir = getGitDocsCloneDir(project.id);

    const svc = new DocsPushService();
    const result = await svc.run(repo, {
      cacheDir,
      cloneUrl: connectorCfg.cloneUrl,
      targetBranch: connectorCfg.targetBranch ?? "specgen-docs",
      docsRoot: connectorCfg.docsRoot ?? "docs",
      token: tokenValue.token,
      author: connectorCfg.author ?? {
        name: "SpecGen Bot",
        email: "specgen-bot@noreply.specgen.dev",
      },
      overwriteStrategy: connectorCfg.overwriteStrategy ?? "halt",
      runId,
      lastPushedSha: state?.last_pushed_sha ?? undefined,
    });

    if (result.pushedSha) {
      gitDocsState.upsert({
        project_id: project.id,
        last_pushed_sha: result.pushedSha,
        last_source_sha: null,
        last_run_id: runId,
        last_pushed_at: new Date().toISOString(),
      });
    }
    return { pushedSha: result.pushedSha, filesWritten: result.filesWritten, runId };
  })();

  inflightPushes.set(project.id, pushPromise);
  try {
    return await pushPromise;
  } finally {
    inflightPushes.delete(project.id);
  }
}

// Re-export the conflict type for callers that switch on it (the REST handler).
export { DocsPushConflictError };
