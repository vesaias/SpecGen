import { promises as fs, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CachedTreeEntry, GitHubBlobCache } from "../../src/parser/githubBlobCache.js";

describe("GitHubBlobCache", () => {
  let dir: string;
  let cache: GitHubBlobCache;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "specgen-ghcache-"));
    cache = new GitHubBlobCache(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when reading a blob that hasn't been written", async () => {
    expect(await cache.readBlob("deadbeef")).toBeNull();
  });

  it("round-trips a blob", async () => {
    const sha = "abc123";
    await cache.writeBlob(sha, "hello world");
    expect(await cache.readBlob(sha)).toBe("hello world");
  });

  it("shards blobs by sha prefix", async () => {
    const sha = "abcdef0123";
    await cache.writeBlob(sha, "x");
    // file should live at blobs/ab/abcdef0123
    expect(existsSync(path.join(dir, "blobs", "ab", sha))).toBe(true);
  });

  it("blobPath returns the sharded path regardless of presence", () => {
    expect(cache.blobPath("abcdef")).toBe(path.join(dir, "blobs", "ab", "abcdef"));
  });

  it("writeBlob is crash-safe (no .tmp file left behind on success)", async () => {
    await cache.writeBlob("xx", "content");
    const blobDir = path.join(dir, "blobs", "xx");
    const files = await fs.readdir(blobDir);
    expect(files).toEqual(["xx"]); // no .tmp leftover
  });

  it("returns null when reading a tree that hasn't been written", async () => {
    expect(await cache.readTree("commitsha")).toBeNull();
  });

  it("round-trips a tree", async () => {
    const tree: CachedTreeEntry[] = [
      { path: "src/main.ts", type: "blob", sha: "aaa", size: 100 },
      { path: "src", type: "tree", sha: "bbb", size: 0 },
    ];
    await cache.writeTree("commit1", tree);
    const read = await cache.readTree("commit1");
    expect(read).toEqual(tree);
  });

  it("returns null when reading a corrupt tree file", async () => {
    const p = path.join(dir, "trees", "bad.json");
    await fs.mkdir(path.dirname(p), { recursive: true });
    writeFileSync(p, "this is not json", "utf8");
    expect(await cache.readTree("bad")).toBeNull();
  });

  it("overwrites an existing blob", async () => {
    await cache.writeBlob("sha", "v1");
    await cache.writeBlob("sha", "v2");
    expect(await cache.readBlob("sha")).toBe("v2");
  });
});
