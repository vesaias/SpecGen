/**
 * githubCommitPoller — Periodically polls the GitHub commits API for every
 * project that has opted into automatic re-enrichment, and enqueues an
 * `enrichment-pipeline` run whenever the upstream branch has moved.
 *
 * Loop:
 *   every interval seconds
 *     for each project with source.type === "github" AND connectors.github.autoPoll
 *       fetch GET /repos/{owner}/{repo}/commits?sha={ref}&per_page=1
 *       compare latest sha to projects.github_last_seen_sha
 *       if NULL — record the sha but DON'T trigger a run (opt-in moment)
 *       if same — record the sha, do nothing
 *       if different — record the sha, enqueue enrichment-pipeline (change-detect)
 *
 * Skips silently when:
 *   - The project has no AI provider configured (same guard as auto-enrich-on-initial-parse)
 *   - The project has no GitHub PAT stored in the encrypted token store
 *
 * The 24-hour default cadence keeps the GitHub API budget (5000 req/hour
 * authenticated) untouchable even with hundreds of opted-in projects. Operators
 * who want tighter feedback can lower `intervalSec` via the env var below.
 *
 * Configuration:
 *   - `SPECGEN_GITHUB_POLL_INTERVAL_SEC` — interval in seconds. Default 86400 (24h).
 *
 * Failures (network, 401/403, 429, 5xx) are logged and the tick continues with
 * the next project; the poller never throws.
 */

import { Octokit } from "octokit";
import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import type { Project, ProjectSourceGitHub } from "../types/Project.js";
import type { RunWorker } from "./RunWorker.js";
import type { TokenStore } from "./TokenStore.js";

const DEFAULT_INTERVAL_SEC = 86400; // 24 hours

export interface GithubCommitPollerDeps {
  worker: RunWorker;
  projects: SqliteProjectRepository;
  tokens: TokenStore;
}

export interface GithubCommitPollerOptions {
  /** Override the interval (seconds). Defaults to env var or 86400. */
  intervalSec?: number;
  /** Override the clock (tests). */
  now?: () => Date;
}

interface AutoPollConnectorCfg {
  autoPoll?: boolean;
}

function isAutoPollEnabled(project: Project): boolean {
  const cfg = (project.connectors as { github?: AutoPollConnectorCfg }).github;
  return cfg?.autoPoll === true;
}

function isAiConfigured(project: Project): boolean {
  const ai = project.ai as { provider?: string } | undefined;
  const provider = ai?.provider;
  return Boolean(provider) && provider !== "local";
}

/**
 * Install a background interval that polls each opted-in GitHub-source project
 * for new commits. Returns a disposer that stops the interval and prevents
 * any further ticks.
 */
export function installGithubCommitPoller(
  deps: GithubCommitPollerDeps,
  opts: GithubCommitPollerOptions = {},
): () => void {
  const intervalSec =
    opts.intervalSec ??
    (Number(process.env.SPECGEN_GITHUB_POLL_INTERVAL_SEC ?? "") || DEFAULT_INTERVAL_SEC);

  if (intervalSec < 60) {
    process.stderr.write(
      `[github-poller] refusing to use interval ${intervalSec}s (< 60s would burn GitHub API quota); falling back to ${DEFAULT_INTERVAL_SEC}s\n`,
    );
  }
  const safeInterval = intervalSec >= 60 ? intervalSec : DEFAULT_INTERVAL_SEC;

  const tick = async (): Promise<void> => {
    try {
      await pollAllProjects(deps);
    } catch (err) {
      process.stderr.write(`[github-poller] tick failed: ${(err as Error).message}\n`);
    }
  };

  const timer = setInterval(() => void tick(), safeInterval * 1000);
  process.stdout.write(
    `[github-poller] started — interval ${safeInterval}s (${Math.round(safeInterval / 3600)}h)\n`,
  );
  return () => {
    clearInterval(timer);
  };
}

async function pollAllProjects(deps: GithubCommitPollerDeps): Promise<void> {
  const projects = deps.projects.list();
  for (const project of projects) {
    if (project.source.type !== "github") continue;
    if (!isAutoPollEnabled(project)) continue;
    if (!isAiConfigured(project)) {
      process.stdout.write(
        `[github-poller] ${project.slug}: skipped (no AI provider configured)\n`,
      );
      continue;
    }
    await pollOne(project, deps);
  }
}

async function pollOne(project: Project, deps: GithubCommitPollerDeps): Promise<void> {
  const source = project.source as ProjectSourceGitHub;

  // Pull token from the encrypted store. If absent → skip silently (the user
  // may have revoked it; surface via stderr but don't crash the loop).
  const tok = await deps.tokens.get({ projectId: project.id, provider: "github" });
  if (!tok || tok.provider !== "github") {
    process.stdout.write(
      `[github-poller] ${project.slug}: autoPoll enabled but no GitHub token stored; skipping\n`,
    );
    return;
  }

  const octokit = new Octokit({ auth: tok.token });
  let latestSha: string;
  try {
    // /repos/{owner}/{repo}/commits?sha=<branch>&per_page=1 returns the latest
    // commit on the branch. Cheaper than fetching the full commits list.
    const resp = await octokit.rest.repos.listCommits({
      owner: source.owner,
      repo: source.repo,
      sha: source.ref ?? "main",
      per_page: 1,
    });
    const head = resp.data[0];
    if (!head?.sha) {
      process.stderr.write(
        `[github-poller] ${project.slug}: GitHub returned no commits for ${source.owner}/${source.repo}@${source.ref ?? "main"}\n`,
      );
      return;
    }
    latestSha = head.sha;
  } catch (err) {
    process.stderr.write(
      `[github-poller] ${project.slug}: GitHub API failed: ${(err as Error).message}\n`,
    );
    return;
  }

  const lastSeen = deps.projects.getGithubLastSeenSha(project.id);

  if (lastSeen === null) {
    // First-ever poll: record the sha without triggering a run. Opting a
    // project in shouldn't immediately blow tokens on re-enrichment.
    deps.projects.setGithubLastSeenSha(project.id, latestSha);
    process.stdout.write(
      `[github-poller] ${project.slug}: first poll, recorded sha=${latestSha.slice(0, 8)} (no run triggered)\n`,
    );
    return;
  }

  if (lastSeen === latestSha) {
    // No change. (Refresh updated_at via the setter so the row's mtime tracks
    // poll activity, but skip the run.)
    deps.projects.setGithubLastSeenSha(project.id, latestSha);
    return;
  }

  // SHA moved → enqueue change-detect enrichment. Auto-push (if configured)
  // will fire on completion via installAutoPushOnRunComplete.
  deps.projects.setGithubLastSeenSha(project.id, latestSha);
  const profileId = (project.ai as { profileId?: string } | undefined)?.profileId ?? "pm-spec";
  const runId = deps.worker.enqueue({
    projectId: project.id,
    generatorId: "enrichment-pipeline",
    profileId,
    options: { mode: "change-detect" },
  });
  process.stdout.write(
    `[github-poller] ${project.slug}: sha moved ${lastSeen.slice(0, 8)} → ${latestSha.slice(0, 8)}; enqueued run ${runId}\n`,
  );
}
