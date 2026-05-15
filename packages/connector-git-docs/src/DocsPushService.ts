import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import type { Block, SpecItem, SpecRepository } from "@specgen/core";
import { pathForItem, renderItemMarkdown } from "@specgen/core";
import simpleGit, { type SimpleGit } from "simple-git";
import { type DocsPushConfig, DocsPushConflictError, type DocsPushResult } from "./types.js";

/**
 * Branches that we refuse to force-push to. `force` strategy is only safe on a
 * dedicated SpecGen branch — protecting `main`/`master` is a basic safety net.
 */
const SAFETY_BRANCHES = new Set(["main", "master"]);

/**
 * DocsPushService — clones a target Git repo, materializes the SpecGen spec as
 * Markdown under `<docsRoot>`, commits, and pushes to a dedicated branch.
 *
 * Token isolation invariant:
 *   The PAT is NEVER written to .git/config — it is injected only via the
 *   per-invocation `-c http.extraheader=...` flag on `git fetch` and `git push`.
 *   The smoke test verifies this by grepping `.git/config` after a push.
 *
 * Strategy:
 *   1. Ensure clone exists (shallow, single-branch). Create with
 *      `git clone --depth=50 --single-branch --branch <targetBranch>`.
 *   2. Fetch + reset --hard to origin's branch tip + scoped `clean -fdx <docsRoot>`.
 *   3. Conflict detection: if `overwriteStrategy === "halt"` and `lastPushedSha`
 *      is set and differs from `origin/<branch>` HEAD, throw DocsPushConflictError.
 *   4. Materialize: walk the snapshot, render each item via `renderItemMarkdown`,
 *      write to `<cacheDir>/<docsRoot>/<tree-path>/<id>.md`. Write a
 *      `.specgen-managed` marker so users know this tree is automated.
 *   5. Idempotency: `git add <docsRoot>` then diff --cached --stat; if empty,
 *      return without committing.
 *   6. Commit with [skip ci] tag and SpecGen-Run-Id trailer.
 *   7. Push via `-c http.extraheader=AUTHORIZATION: bearer <token>`.
 */
export class DocsPushService {
  async run(spec: SpecRepository, cfg: DocsPushConfig): Promise<DocsPushResult> {
    if (SAFETY_BRANCHES.has(cfg.targetBranch.toLowerCase()) && cfg.overwriteStrategy === "force") {
      throw new Error(
        `Refusing to force-push to ${cfg.targetBranch}. Use a different targetBranch or overwriteStrategy='halt'.`,
      );
    }

    cfg.onProgress?.(`Ensuring clone at ${cfg.cacheDir}`);
    await this.ensureClone(cfg);

    const git = simpleGit(cfg.cacheDir);
    cfg.onProgress?.("Fetching origin");
    await this.fetchOrigin(git, cfg);

    const remoteSha = (await git.revparse([`origin/${cfg.targetBranch}`])).trim();
    if (cfg.overwriteStrategy === "halt" && cfg.lastPushedSha && remoteSha !== cfg.lastPushedSha) {
      throw new DocsPushConflictError(
        `Remote ${cfg.targetBranch} has advanced since our last push; refusing to overwrite`,
        remoteSha,
        cfg.lastPushedSha,
      );
    }

    await git.reset(["--hard", `origin/${cfg.targetBranch}`]);
    cfg.onProgress?.("Cleaning docsRoot");
    // -f force, -d directories, -x ignored, scoped to docsRoot only.
    // docsRoot may not exist yet on a fresh branch — ignore the resulting error.
    try {
      await git.raw(["clean", "-fdx", "--", cfg.docsRoot]);
    } catch {
      /* ignore — docsRoot may not exist yet */
    }

    cfg.onProgress?.("Materializing spec → Markdown");
    const filesWritten = await this.materializeSpec(spec, cfg);

    cfg.onProgress?.("Staging changes");
    await git.add([cfg.docsRoot]);
    const cachedDiff = await git.diff(["--cached", "--stat"]);
    if (cachedDiff.trim() === "") {
      cfg.onProgress?.("No changes to commit");
      return { pushedSha: null, filesWritten };
    }

    cfg.onProgress?.("Committing");
    const message = this.buildCommitMessage(cfg);
    await git
      .env({
        GIT_AUTHOR_NAME: cfg.author.name,
        GIT_AUTHOR_EMAIL: cfg.author.email,
        GIT_COMMITTER_NAME: cfg.author.name,
        GIT_COMMITTER_EMAIL: cfg.author.email,
      })
      .commit(message);

    cfg.onProgress?.("Pushing");
    await this.pushOrigin(git, cfg);
    const pushedSha = (await git.revparse(["HEAD"])).trim();
    return { pushedSha, filesWritten };
  }

  /**
   * Build the per-invocation `-c http.extraheader=...` arg. Returned in two
   * pieces so callers can splice them into a `git raw` invocation:
   *   git -c "http.extraheader=AUTHORIZATION: bearer <token>" <cmd> ...
   *
   * NEVER persist this to .git/config via `git config` — that's the whole
   * point of the per-invocation approach.
   */
  private extraHeader(token: string): string {
    return `http.extraheader=AUTHORIZATION: bearer ${token}`;
  }

  /**
   * file:// remotes don't speak the HTTP protocol, so the extraheader config
   * is meaningless (and on some git versions, harmlessly ignored). We still
   * pass it for HTTPS remotes — the only place it actually matters.
   */
  private isHttpRemote(cloneUrl: string): boolean {
    return /^https?:\/\//i.test(cloneUrl);
  }

  private buildCommitMessage(cfg: DocsPushConfig): string {
    const headLine = cfg.sourceCommitSha
      ? `docs: regenerate from ${cfg.sourceCommitSha.slice(0, 7)} [skip ci]`
      : "docs: regenerate [skip ci]";
    return `${headLine}\n\nSpecGen-Run-Id: ${cfg.runId}\n`;
  }

  private async ensureClone(cfg: DocsPushConfig): Promise<void> {
    if (existsSync(path.join(cfg.cacheDir, ".git"))) return;
    await fs.mkdir(path.dirname(cfg.cacheDir), { recursive: true });
    const git = simpleGit();
    const args: string[] = [];
    if (this.isHttpRemote(cfg.cloneUrl)) {
      args.push("-c", this.extraHeader(cfg.token));
    }
    args.push(
      "clone",
      "--depth=50",
      "--single-branch",
      "--branch",
      cfg.targetBranch,
      cfg.cloneUrl,
      cfg.cacheDir,
    );
    await git.raw(args);
  }

  private async fetchOrigin(git: SimpleGit, cfg: DocsPushConfig): Promise<void> {
    const args: string[] = [];
    if (this.isHttpRemote(cfg.cloneUrl)) {
      args.push("-c", this.extraHeader(cfg.token));
    }
    args.push("fetch", "--depth=50", "origin", cfg.targetBranch);
    await git.raw(args);
  }

  private async pushOrigin(git: SimpleGit, cfg: DocsPushConfig): Promise<void> {
    const args: string[] = [];
    if (this.isHttpRemote(cfg.cloneUrl)) {
      args.push("-c", this.extraHeader(cfg.token));
    }
    args.push("push", "origin", cfg.targetBranch);
    await git.raw(args);
  }

  /**
   * Only allow ids that are safe to embed in a file path. This is the first
   * line of defence against path-traversal attacks (e.g. `../etc/passwd` or
   * Windows drive-relative paths like `C:foo`). The existing `path.relative`
   * check below is kept as belt-and-braces.
   */
  private static readonly VALID_ITEM_ID = /^[A-Za-z0-9._-]+$/;

  private async materializeSpec(spec: SpecRepository, cfg: DocsPushConfig): Promise<number> {
    const snap = await spec.snapshot();
    const docsAbs = path.join(cfg.cacheDir, cfg.docsRoot);
    await fs.mkdir(docsAbs, { recursive: true });

    let count = 0;
    for (const [id, item] of Object.entries(snap.items)) {
      if (!DocsPushService.VALID_ITEM_ID.test(id)) {
        cfg.onWarning?.(`Refusing to write item ${JSON.stringify(id)} — invalid characters in id`);
        continue;
      }
      const filePath = pathForItem(snap.spec.tree, id);
      const target = path.join(docsAbs, filePath);
      // Path traversal safety: ensure target is under docsAbs.
      const rel = path.relative(docsAbs, target);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        cfg.onWarning?.(`Refusing to write item ${id} — path traversal detected (${filePath})`);
        continue;
      }
      await fs.mkdir(path.dirname(target), { recursive: true });
      const itemWithBlocks = item as SpecItem & { blocks?: Block[] };
      await fs.writeFile(target, renderItemMarkdown(itemWithBlocks), "utf8");
      count++;
    }

    // .specgen-managed marker — helps users know what they're looking at.
    await fs.writeFile(
      path.join(docsAbs, ".specgen-managed"),
      `Managed by SpecGen — do not edit.\nRun: ${cfg.runId}\n`,
      "utf8",
    );

    return count;
  }
}
