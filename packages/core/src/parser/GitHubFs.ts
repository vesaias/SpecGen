import path from "node:path";
import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "octokit";
import PQueue from "p-queue";
import type { ParserFileSystem } from "./FileSystem.js";
import type { CachedTreeEntry, GitHubBlobCache } from "./githubBlobCache.js";

const ThrottledOctokit = Octokit.plugin(retry, throttling);

/**
 * Minimal Octokit-shaped surface we depend on. The full `Octokit` type from
 * `octokit` satisfies this naturally; tests construct a plain duck-typed object
 * and inject it via `opts.octokit` to avoid real HTTP traffic.
 */
export interface OctokitLike {
  rest: {
    repos: {
      getCommit: (params: { owner: string; repo: string; ref: string }) => Promise<{
        data: { sha: string };
      }>;
    };
    git: {
      getTree: (params: {
        owner: string;
        repo: string;
        tree_sha: string;
        recursive?: string;
      }) => Promise<{
        data: {
          truncated?: boolean;
          tree?: Array<{ path?: string; type?: string; sha?: string; size?: number }>;
        };
      }>;
      getBlob: (params: { owner: string; repo: string; file_sha: string }) => Promise<{
        data: { content: string; encoding?: string };
      }>;
    };
  };
}

export interface GitHubFsOpts {
  owner: string;
  repo: string;
  /** Branch, tag, or commit SHA. Resolved to a commit SHA in `resolve()`. */
  ref: string;
  /**
   * Personal-access token or installation token. Required for production use;
   * tests injecting their own `octokit` may pass an empty string.
   */
  token: string;
  cache: GitHubBlobCache;
  /**
   * Forward rate-limit + LFS-pointer warnings to the caller. RunWorker hooks
   * this to RunEventBroker.emit so they surface in the UI.
   */
  onWarning?: (msg: string) => void;
  /** Bounded concurrency for blob fetches. Default 10. */
  concurrency?: number;
  /**
   * Inject a pre-built Octokit (or duck-typed mock) instead of constructing
   * one from `token`. Used by tests; production code path leaves this unset.
   */
  octokit?: OctokitLike;
}

/**
 * `ParserFileSystem` backed by the GitHub REST API (Octokit) with a SHA-keyed
 * on-disk cache.
 *
 * Flow:
 *   1. `resolve()` (called lazily on the first method) resolves `ref` → commit SHA
 *      via `GET /repos/{owner}/{repo}/commits/{ref}`.
 *   2. The full recursive tree for that commit is fetched (or read from cache).
 *   3. Subsequent `readFile` calls look up the blob SHA in the cached tree and
 *      either read from the on-disk cache or fetch via `GET /git/blobs/{sha}`,
 *      then write the decoded body back to the cache for next time.
 *
 * Because everything is keyed by SHA, a second parse of the same commit hits
 * disk only — no network. A new commit fetches just the tree + the blobs whose
 * SHAs changed.
 *
 * Limitations (documented for D.5):
 *   - Read-only. Pushes (D.6) use git directly, not Octokit.
 *   - Text only. Binary blobs decode to UTF-8 and round-trip lossy.
 *   - Git LFS pointers are surfaced as warnings; their content is not fetched.
 */
export class GitHubFs implements ParserFileSystem {
  /**
   * Logical root — diagnostic only. Relative paths in this fs are anchored
   * at the repository root (no real disk path exists).
   */
  readonly rootDir = "/";

  private readonly octokit: OctokitLike;
  private commitSha?: string;
  /** path → { sha, type, size }. Populated by `resolve()`. */
  private tree?: Map<string, { sha: string; type: "blob" | "tree"; size: number }>;
  private readonly queue: PQueue;
  private resolvePromise?: Promise<void>;
  /** SHA → in-flight fetch promise. Prevents duplicate blob fetches for the same SHA. */
  private readonly inflightBlobs = new Map<string, Promise<string>>();

  constructor(private readonly opts: GitHubFsOpts) {
    if (opts.octokit) {
      this.octokit = opts.octokit;
    } else {
      this.octokit = new ThrottledOctokit({
        auth: opts.token,
        throttle: {
          onRateLimit: (retryAfter, _options, _o, retryCount) => {
            opts.onWarning?.(
              `GitHub rate limit: retry in ${retryAfter}s (attempt ${retryCount + 1})`,
            );
            // Retry up to 2 times
            return retryCount < 2;
          },
          onSecondaryRateLimit: (retryAfter, _options, _o, retryCount) => {
            opts.onWarning?.(
              `GitHub secondary rate limit: retry in ${retryAfter}s (attempt ${retryCount + 1})`,
            );
            return retryCount < 2;
          },
        },
      }) as unknown as OctokitLike;
    }
    this.queue = new PQueue({ concurrency: opts.concurrency ?? 10 });
  }

  /**
   * Idempotent. Resolves `ref` → commit SHA and fetches (or loads from cache)
   * the recursive tree for that commit. Subsequent calls return immediately;
   * concurrent callers share the same promise so we never fetch the tree twice.
   */
  async resolve(): Promise<void> {
    if (this.tree) return;
    if (this.resolvePromise) return this.resolvePromise;
    this.resolvePromise = this.doResolve();
    try {
      await this.resolvePromise;
    } finally {
      // Keep the cache populated; clear the in-flight handle either way.
      this.resolvePromise = undefined;
    }
  }

  private async doResolve(): Promise<void> {
    const commit = await this.octokit.rest.repos.getCommit({
      owner: this.opts.owner,
      repo: this.opts.repo,
      ref: this.opts.ref,
    });
    this.commitSha = commit.data.sha;

    let entries: CachedTreeEntry[];
    const cached = await this.opts.cache.readTree(this.commitSha);
    if (cached) {
      entries = cached;
    } else {
      const r = await this.octokit.rest.git.getTree({
        owner: this.opts.owner,
        repo: this.opts.repo,
        tree_sha: this.commitSha,
        recursive: "1",
      });
      if (r.data.truncated) {
        this.opts.onWarning?.(
          "GitHub tree truncated — repository exceeds the API's 100k-entry / 7MB limit; some files will be missing from this parse.",
        );
      }
      entries = (r.data.tree ?? []).map((e) => ({
        path: e.path ?? "",
        type: e.type === "tree" ? "tree" : "blob",
        sha: e.sha ?? "",
        size: e.size ?? 0,
      }));
      await this.opts.cache.writeTree(this.commitSha, entries);
    }

    this.tree = new Map(entries.map((e) => [e.path, { sha: e.sha, type: e.type, size: e.size }]));
  }

  /** The commit SHA `ref` resolved to. `undefined` until `resolve()` runs. */
  get resolvedCommitSha(): string | undefined {
    return this.commitSha;
  }

  private normPath(rel: string): string {
    return rel.replace(/^\/+/, "");
  }

  /**
   * Get a guaranteed-loaded tree reference. `resolve()` always assigns
   * `this.tree`, so this is just a non-null-assertion-free way for callers
   * after `await this.resolve()` to read it.
   */
  private async ensureTree(): Promise<
    Map<string, { sha: string; type: "blob" | "tree"; size: number }>
  > {
    await this.resolve();
    if (!this.tree) {
      // Unreachable in practice — `resolve()` always populates `this.tree`.
      throw new Error("GitHubFs: tree not populated after resolve()");
    }
    return this.tree;
  }

  async readFile(rel: string): Promise<string> {
    const tree = await this.ensureTree();
    const norm = this.normPath(rel);
    const entry = tree.get(norm);
    if (!entry || entry.type !== "blob") {
      throw Object.assign(new Error(`File not in tree: ${rel}`), { code: "ENOENT" });
    }
    const cached = await this.opts.cache.readBlob(entry.sha);
    if (cached !== null) return cached;

    // Dedup concurrent reads for the same SHA — if a fetch is already in-flight,
    // await the existing promise instead of issuing a second API call.
    const existing = this.inflightBlobs.get(entry.sha);
    if (existing) return existing;

    const sha = entry.sha;
    const promise = this.queue.add(async () => {
      try {
        const r = await this.octokit.rest.git.getBlob({
          owner: this.opts.owner,
          repo: this.opts.repo,
          file_sha: sha,
        });
        // GitHub returns base64-encoded content for files >1KB; smaller files
        // may use "utf-8" (rare; trust the encoding field).
        const decoded =
          r.data.encoding === "utf-8"
            ? r.data.content
            : Buffer.from(r.data.content, "base64").toString("utf8");
        const isLfsPointer = decoded.startsWith("version https://git-lfs.github.com/spec/v1");
        if (isLfsPointer) {
          // Don't cache LFS pointers — we want the warning to re-emit on every
          // run until the user has resolved the LFS situation.
          this.opts.onWarning?.(
            `LFS pointer at ${rel} — actual content not fetched (cache bypassed so warning re-emits next run)`,
          );
          return decoded;
        }
        await this.opts.cache.writeBlob(sha, decoded);
        return decoded;
      } finally {
        this.inflightBlobs.delete(sha);
      }
    }) as Promise<string>;
    this.inflightBlobs.set(sha, promise);
    return promise;
  }

  async exists(rel: string): Promise<boolean> {
    const tree = await this.ensureTree();
    const norm = this.normPath(rel);
    if (tree.has(norm)) return true;
    // Treat any path that is a prefix of an existing entry as an implicit
    // directory (the GitHub tree response often lists files only).
    const prefix = `${norm}/`;
    for (const p of tree.keys()) {
      if (p.startsWith(prefix)) return true;
    }
    return false;
  }

  async stat(rel: string): Promise<{ size: number; isDirectory: boolean; sha?: string }> {
    const tree = await this.ensureTree();
    const norm = this.normPath(rel);
    const e = tree.get(norm);
    if (e) {
      return { size: e.size, isDirectory: e.type === "tree", sha: e.sha };
    }
    // Implicit directory (no explicit tree entry but children exist)
    const prefix = `${norm}/`;
    for (const p of tree.keys()) {
      if (p.startsWith(prefix)) {
        return { size: 0, isDirectory: true };
      }
    }
    throw Object.assign(new Error(`Not in tree: ${rel}`), { code: "ENOENT" });
  }

  async listDir(rel: string): Promise<Array<{ name: string; isDirectory: boolean; sha?: string }>> {
    const tree = await this.ensureTree();
    const norm = rel.replace(/^\/+|\/+$/g, "");
    const prefix = norm ? `${norm}/` : "";
    const seen = new Set<string>();
    const out: Array<{ name: string; isDirectory: boolean; sha?: string }> = [];
    for (const p of tree.keys()) {
      if (prefix && !p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      if (!rest) continue;
      const slash = rest.indexOf("/");
      const name = slash === -1 ? rest : rest.slice(0, slash);
      if (seen.has(name)) continue;
      seen.add(name);
      const exact = tree.get(prefix + name);
      if (exact) {
        out.push({
          name,
          isDirectory: exact.type === "tree",
          sha: exact.type === "blob" ? exact.sha : undefined,
        });
      } else {
        // Implicit directory — no explicit entry but children exist
        out.push({ name, isDirectory: true });
      }
    }
    return out;
  }

  async *walk(
    rel: string,
    opts: { ignore?: string[] } = {},
  ): AsyncIterable<{ path: string; isDirectory: boolean; sha?: string }> {
    const tree = await this.ensureTree();
    const ignoreSet = new Set(opts.ignore ?? []);
    const norm = rel.replace(/^\/+|\/+$/g, "");
    const prefix = norm ? `${norm}/` : "";
    for (const [p, e] of tree) {
      // Filter to entries under the given subroot
      if (prefix && !p.startsWith(prefix)) continue;
      // Skip any path that has a segment matching the ignore list
      const segments = p.split("/");
      if (segments.some((s) => ignoreSet.has(s))) continue;
      yield {
        path: p,
        isDirectory: e.type === "tree",
        sha: e.type === "blob" ? e.sha : undefined,
      };
    }
  }

  /**
   * Return a virtual sub-rooted view of this filesystem. Shares the parent's
   * resolved tree + Octokit + cache — no extra API calls. See `GitHubSubFs`.
   */
  subFs(relPath: string): ParserFileSystem {
    return new GitHubSubFs(this, relPath.replace(/^\/+|\/+$/g, ""));
  }
}

/**
 * Sub-rooted view onto a parent `GitHubFs` (or another `GitHubSubFs`). Rewrites
 * every relative path by prepending the configured subdir before delegating to
 * the parent. Used by `subdirAwarePlugin` to retry parsers inside immediate
 * child directories of a GitHub-sourced repo.
 *
 * GitHub paths are always forward-slash separated regardless of host OS, so we
 * use `path.posix.join` to avoid Windows backslash leakage.
 */
export class GitHubSubFs implements ParserFileSystem {
  readonly rootDir: string;

  /**
   * Commit SHA from the underlying GitHubFs. Lets callers branch on github-vs-
   * local without needing instanceof checks for both GitHubFs + GitHubSubFs.
   */
  get resolvedCommitSha(): string | undefined {
    let p: ParserFileSystem = this.parent;
    while (p instanceof GitHubSubFs) p = p.parent;
    return p instanceof GitHubFs ? p.resolvedCommitSha : undefined;
  }

  constructor(
    public readonly parent: ParserFileSystem,
    private readonly subPath: string,
  ) {
    // Parent.rootDir is "/" for a fresh GitHubFs; for a nested GitHubSubFs it's
    // already a posix-style path like "/backend". Either way, posix.join gives
    // us the correct logical root (e.g. "/backend" or "/backend/api").
    this.rootDir = path.posix.join(parent.rootDir, subPath);
  }

  private resolve(rel: string): string {
    const norm = rel.replace(/^\/+/, "");
    if (!norm || norm === ".") return this.subPath;
    return path.posix.join(this.subPath, norm);
  }

  async readFile(rel: string): Promise<string> {
    return this.parent.readFile(this.resolve(rel));
  }

  async exists(rel: string): Promise<boolean> {
    return this.parent.exists(this.resolve(rel));
  }

  async stat(rel: string): Promise<{ size: number; isDirectory: boolean; sha?: string }> {
    return this.parent.stat(this.resolve(rel));
  }

  async listDir(rel: string): Promise<Array<{ name: string; isDirectory: boolean; sha?: string }>> {
    return this.parent.listDir(this.resolve(rel));
  }

  async *walk(
    rel: string,
    opts?: { ignore?: string[] },
  ): AsyncIterable<{ path: string; isDirectory: boolean; sha?: string }> {
    const subRoot = this.resolve(rel);
    const prefix = subRoot ? `${subRoot}/` : "";
    for await (const entry of this.parent.walk(subRoot, opts)) {
      // Re-anchor yielded paths to this sub-fs root so consumers see paths
      // relative to the sub-root, matching how LocalFs.walk behaves.
      const reanchored =
        prefix && entry.path.startsWith(prefix)
          ? entry.path.slice(prefix.length)
          : entry.path === subRoot
            ? ""
            : entry.path;
      if (!reanchored) continue;
      yield { ...entry, path: reanchored };
    }
  }

  subFs(relPath: string): ParserFileSystem {
    return new GitHubSubFs(
      this.parent,
      path.posix.join(this.subPath, relPath.replace(/^\/+|\/+$/g, "")),
    );
  }
}
