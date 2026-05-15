import { promises as fs, existsSync } from "node:fs";
import path from "node:path";

/**
 * On-disk cache for GitHub trees + blobs, keyed by SHA.
 *
 * Layout under `cacheDir`:
 *
 *   trees/<commit_sha>.json    — the full recursive tree response for a commit
 *   blobs/<sha[0..2]>/<sha>    — raw decoded file content (utf8)
 *
 * Writes go through a `.tmp + rename` dance so a crash mid-write never leaves
 * a partially-written file readable. Read-paths use `existsSync` first because
 * "missing" is a frequent legitimate state and we don't want EONOENT noise in
 * logs / tracing.
 */
export interface CachedTreeEntry {
  path: string;
  type: "blob" | "tree";
  sha: string;
  size: number;
}

export class GitHubBlobCache {
  constructor(private readonly cacheDir: string) {}

  /** Disk path where a given blob sha is stored (regardless of presence). */
  blobPath(sha: string): string {
    return path.join(this.cacheDir, "blobs", sha.slice(0, 2), sha);
  }

  async readBlob(sha: string): Promise<string | null> {
    const p = this.blobPath(sha);
    if (!existsSync(p)) return null;
    return fs.readFile(p, "utf8");
  }

  async writeBlob(sha: string, content: string): Promise<void> {
    const p = this.blobPath(sha);
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, p);
  }

  async readTree(commitSha: string): Promise<CachedTreeEntry[] | null> {
    const p = path.join(this.cacheDir, "trees", `${commitSha}.json`);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(await fs.readFile(p, "utf8")) as CachedTreeEntry[];
    } catch {
      // Corrupt cache file — treat as miss; the API will refetch and overwrite.
      return null;
    }
  }

  async writeTree(commitSha: string, tree: CachedTreeEntry[]): Promise<void> {
    const p = path.join(this.cacheDir, "trees", `${commitSha}.json`);
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(tree), "utf8");
    await fs.rename(tmp, p);
  }
}
