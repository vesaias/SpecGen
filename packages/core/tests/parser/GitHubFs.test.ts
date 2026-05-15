import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubFs, type OctokitLike } from "../../src/parser/GitHubFs.js";
import { GitHubBlobCache } from "../../src/parser/githubBlobCache.js";

/**
 * Build a duck-typed Octokit stand-in. Tests pass it in via `opts.octokit`
 * so GitHubFs never makes a real HTTP request.
 */
function makeMockOctokit(
  files: Record<string, { sha: string; content: string }>,
  opts: { truncated?: boolean; commitSha?: string } = {},
): { octokit: OctokitLike; calls: { getCommit: number; getTree: number; getBlob: number } } {
  const calls = { getCommit: 0, getTree: 0, getBlob: 0 };
  const tree = Object.entries(files).map(([p, { sha, content }]) => ({
    path: p,
    type: "blob" as const,
    sha,
    size: content.length,
  }));
  // Also add a couple of explicit tree-type entries to test directory handling
  const dirs = new Set<string>();
  for (const p of Object.keys(files)) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  for (const d of dirs) {
    tree.push({
      path: d,
      type: "blob" as const, // typed as blob for ts but we override below
      sha: `dir-${d}`,
      size: 0,
    });
  }
  // Mark dir entries as actual "tree" type via a parallel map
  const fullTree = tree.map((e) =>
    dirs.has(e.path) ? { ...e, type: "tree" as "blob" | "tree" } : e,
  );

  const octokit: OctokitLike = {
    rest: {
      repos: {
        getCommit: async () => {
          calls.getCommit++;
          return { data: { sha: opts.commitSha ?? "commit-abc" } };
        },
      },
      git: {
        getTree: async () => {
          calls.getTree++;
          return {
            data: {
              truncated: opts.truncated ?? false,
              tree: fullTree,
            },
          };
        },
        getBlob: async ({ file_sha }) => {
          calls.getBlob++;
          const entry = Object.entries(files).find(([, v]) => v.sha === file_sha);
          if (!entry) throw new Error(`Unknown blob sha: ${file_sha}`);
          return {
            data: {
              content: Buffer.from(entry[1].content, "utf8").toString("base64"),
              encoding: "base64",
            },
          };
        },
      },
    },
  };
  return { octokit, calls };
}

describe("GitHubFs", () => {
  let cacheDir: string;
  let cache: GitHubBlobCache;

  beforeEach(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), "specgen-ghfs-"));
    cache = new GitHubBlobCache(cacheDir);
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("resolve() resolves ref → commit sha", async () => {
    const { octokit } = makeMockOctokit(
      { "README.md": { sha: "blob1", content: "# hi" } },
      { commitSha: "deadbeef" },
    );
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
    });
    await gfs.resolve();
    expect(gfs.resolvedCommitSha).toBe("deadbeef");
  });

  it("readFile fetches a blob via the API on first call, then serves from cache", async () => {
    const { octokit, calls } = makeMockOctokit({
      "src/foo.ts": { sha: "blob1", content: "export const x = 1;" },
    });
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
    });
    expect(await gfs.readFile("src/foo.ts")).toBe("export const x = 1;");
    expect(calls.getBlob).toBe(1);
    // Second call — should hit the on-disk cache
    expect(await gfs.readFile("src/foo.ts")).toBe("export const x = 1;");
    expect(calls.getBlob).toBe(1);
  });

  it("readFile tolerates a leading slash on the relative path", async () => {
    const { octokit } = makeMockOctokit({
      "src/foo.ts": { sha: "blob1", content: "ok" },
    });
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
    });
    expect(await gfs.readFile("/src/foo.ts")).toBe("ok");
  });

  it("readFile throws ENOENT for a missing path", async () => {
    const { octokit } = makeMockOctokit({
      "README.md": { sha: "x", content: "hi" },
    });
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
    });
    await expect(gfs.readFile("nope.txt")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("exists returns true for blobs and explicit dirs", async () => {
    const { octokit } = makeMockOctokit({
      "src/foo.ts": { sha: "x", content: "x" },
      "src/bar.ts": { sha: "y", content: "y" },
    });
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
    });
    expect(await gfs.exists("src/foo.ts")).toBe(true);
    expect(await gfs.exists("src")).toBe(true);
    expect(await gfs.exists("nonexistent")).toBe(false);
  });

  it("stat returns size + isDirectory + sha for blobs", async () => {
    const { octokit } = makeMockOctokit({
      "a.ts": { sha: "blob1", content: "hello" },
    });
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
    });
    const s = await gfs.stat("a.ts");
    expect(s.isDirectory).toBe(false);
    expect(s.size).toBe(5);
    expect(s.sha).toBe("blob1");
  });

  it("stat returns isDirectory=true for tree entries", async () => {
    const { octokit } = makeMockOctokit({
      "src/foo.ts": { sha: "x", content: "x" },
    });
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
    });
    const s = await gfs.stat("src");
    expect(s.isDirectory).toBe(true);
  });

  it("listDir returns immediate children only", async () => {
    const { octokit } = makeMockOctokit({
      "src/foo.ts": { sha: "1", content: "x" },
      "src/bar.ts": { sha: "2", content: "y" },
      "src/sub/baz.ts": { sha: "3", content: "z" },
      "README.md": { sha: "4", content: "r" },
    });
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
    });
    const entries = await gfs.listDir("src");
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["bar.ts", "foo.ts", "sub"]);
    expect(entries.find((e) => e.name === "sub")?.isDirectory).toBe(true);
    expect(entries.find((e) => e.name === "foo.ts")?.isDirectory).toBe(false);
  });

  it("listDir at the root returns top-level entries", async () => {
    const { octokit } = makeMockOctokit({
      "src/foo.ts": { sha: "1", content: "x" },
      "README.md": { sha: "2", content: "r" },
    });
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
    });
    const entries = await gfs.listDir("");
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(["README.md", "src"]);
  });

  it("walk yields all blob + tree entries under a subdir", async () => {
    const { octokit } = makeMockOctokit({
      "src/foo.ts": { sha: "1", content: "x" },
      "src/bar.ts": { sha: "2", content: "y" },
      "src/sub/baz.ts": { sha: "3", content: "z" },
      "README.md": { sha: "4", content: "r" },
    });
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
    });
    const paths: string[] = [];
    for await (const entry of gfs.walk("src")) {
      paths.push(entry.path);
    }
    expect(paths).toContain("src/foo.ts");
    expect(paths).toContain("src/bar.ts");
    expect(paths).toContain("src/sub/baz.ts");
    expect(paths).not.toContain("README.md");
  });

  it("walk honours opts.ignore", async () => {
    const { octokit } = makeMockOctokit({
      "src/foo.ts": { sha: "1", content: "x" },
      "src/node_modules/x.ts": { sha: "2", content: "y" },
    });
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
    });
    const paths: string[] = [];
    for await (const entry of gfs.walk("", { ignore: ["node_modules"] })) {
      paths.push(entry.path);
    }
    expect(paths).toContain("src/foo.ts");
    expect(paths).not.toContain("src/node_modules/x.ts");
  });

  it("uses the tree from cache when present, skipping the tree API call", async () => {
    const { octokit, calls } = makeMockOctokit({
      "x.ts": { sha: "blob1", content: "x" },
    });
    await cache.writeTree("commit-abc", [{ path: "x.ts", type: "blob", sha: "blob1", size: 1 }]);
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
    });
    await gfs.resolve();
    expect(calls.getCommit).toBe(1);
    expect(calls.getTree).toBe(0); // served from cache
  });

  it("emits a warning when the tree response is truncated", async () => {
    const onWarning = vi.fn();
    const { octokit } = makeMockOctokit(
      { "a.ts": { sha: "x", content: "x" } },
      { truncated: true },
    );
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
      onWarning,
    });
    await gfs.resolve();
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("truncated"));
  });

  it("partial tree files are readable after a truncated response", async () => {
    const warnings: string[] = [];
    const { octokit } = makeMockOctokit(
      {
        "a.ts": { sha: "blob-a", content: "hello" },
        "b.ts": { sha: "blob-b", content: "world" },
      },
      { truncated: true },
    );
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
      onWarning: (m) => warnings.push(m),
    });

    await gfs.resolve();
    expect(warnings.some((w) => w.includes("truncated"))).toBe(true);

    // Files present in the truncated tree should still be fully readable
    expect(await gfs.readFile("a.ts")).toBe("hello");
    expect(await gfs.readFile("b.ts")).toBe("world");
    expect(await gfs.exists("a.ts")).toBe(true);
    expect(await gfs.exists("b.ts")).toBe(true);

    // listDir at root should include both files
    const entries = await gfs.listDir("");
    expect(entries.find((e) => e.name === "a.ts")).toBeDefined();
    expect(entries.find((e) => e.name === "b.ts")).toBeDefined();
  });

  it("emits a warning when a blob is an LFS pointer", async () => {
    const onWarning = vi.fn();
    const { octokit } = makeMockOctokit({
      "big.bin": {
        sha: "x",
        content: "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n",
      },
    });
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
      onWarning,
    });
    await gfs.readFile("big.bin");
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("LFS pointer"));
  });

  it("resolve() is idempotent and concurrent-safe", async () => {
    const { octokit, calls } = makeMockOctokit({
      "x.ts": { sha: "blob1", content: "x" },
    });
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
    });
    // Fire three concurrent calls
    await Promise.all([gfs.resolve(), gfs.resolve(), gfs.resolve()]);
    expect(calls.getCommit).toBe(1);
    expect(calls.getTree).toBe(1);
  });

  it("does not cache LFS pointer blobs, so the warning re-emits next run", async () => {
    const lfsContent =
      "version https://git-lfs.github.com/spec/v1\noid sha256:deadbeef\nsize 1024\n";
    const { octokit } = makeMockOctokit({
      "big.bin": { sha: "lfs-sha", content: lfsContent },
    });
    const warnings: string[] = [];
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
      onWarning: (m) => warnings.push(m),
    });
    const result = await gfs.readFile("big.bin");
    // Warning must have been emitted
    expect(warnings.some((w) => w.includes("LFS pointer"))).toBe(true);
    // Content is still returned to the caller
    expect(result).toContain("version https://git-lfs.github.com/spec/v1");
    // Nothing must have been written to the blob cache
    expect(await cache.readBlob("lfs-sha")).toBeNull();
  });

  it("dedupes concurrent reads for the same SHA into a single API call", async () => {
    const { octokit, calls } = makeMockOctokit({
      "src/f.ts": { sha: "shared-sha", content: "export const x = 1;" },
    });
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
    });
    // Fire three concurrent reads for the exact same file / SHA
    const [a, b, c] = await Promise.all([
      gfs.readFile("src/f.ts"),
      gfs.readFile("src/f.ts"),
      gfs.readFile("src/f.ts"),
    ]);
    expect(a).toBe("export const x = 1;");
    expect(b).toBe("export const x = 1;");
    expect(c).toBe("export const x = 1;");
    // Only one blob API call should have been made despite three concurrent requests
    expect(calls.getBlob).toBe(1);
  });

  it("subFs returns a view that delegates path-prefixed reads to the parent", async () => {
    const { octokit, calls } = makeMockOctokit({
      "backend/MyApp.csproj": { sha: "csproj-sha", content: "<Project/>" },
      "backend/Program.cs": { sha: "prog-sha", content: "// hi" },
      "frontend/package.json": { sha: "pkg-sha", content: '{"name":"fe"}' },
    });
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
    });

    const backend = gfs.subFs("backend");
    // Logical rootDir is posix-style "/backend"
    expect(backend.rootDir).toBe("/backend");

    // listDir(".") on the sub-fs == listDir("backend") on the parent
    const subEntries = (await backend.listDir(".")).map((e) => e.name).sort();
    const parentEntries = (await gfs.listDir("backend")).map((e) => e.name).sort();
    expect(subEntries).toEqual(parentEntries);
    expect(subEntries).toContain("MyApp.csproj");
    expect(subEntries).toContain("Program.cs");

    // readFile resolves against the sub-rooted path
    expect(await backend.readFile("MyApp.csproj")).toBe("<Project/>");

    // exists / stat work through the prefix
    expect(await backend.exists("Program.cs")).toBe(true);
    expect(await backend.exists("nope.cs")).toBe(false);
    const s = await backend.stat("MyApp.csproj");
    expect(s.isDirectory).toBe(false);
    expect(s.sha).toBe("csproj-sha");

    // Shares the parent's resolved tree — no additional getTree calls
    expect(calls.getTree).toBe(1);

    // Nesting: subFs of subFs should re-anchor correctly
    const nested = backend.subFs(".");
    expect(nested.rootDir).toBe("/backend");
  });

  it("subFs.walk yields paths relative to the sub-root", async () => {
    const { octokit } = makeMockOctokit({
      "backend/Program.cs": { sha: "p", content: "// hi" },
      "backend/api/Controller.cs": { sha: "c", content: "// c" },
      "frontend/package.json": { sha: "pkg", content: "{}" },
    });
    const gfs = new GitHubFs({
      owner: "a",
      repo: "b",
      ref: "main",
      token: "",
      cache,
      octokit,
    });
    const backend = gfs.subFs("backend");
    const seen: string[] = [];
    for await (const entry of backend.walk(".")) {
      seen.push(entry.path);
    }
    // Paths re-anchored to backend/ root (no leading "backend/")
    expect(seen).toContain("Program.cs");
    expect(seen).toContain("api/Controller.cs");
    expect(seen).not.toContain("frontend/package.json");
    // Ensure we didn't leak parent-relative paths through the wrapper
    expect(seen.every((p) => !p.startsWith("backend/"))).toBe(true);
  });

  it(
    "smoke: walks aquatko/MockPMS via the real API",
    { skip: !process.env.SPECGEN_TEST_GH_TOKEN },
    async () => {
      const realCache = new GitHubBlobCache(mkdtempSync(path.join(tmpdir(), "ghcache-smoke-")));
      const realFs = new GitHubFs({
        owner: "aquatko",
        repo: "MockPMS",
        ref: "main",
        token: process.env.SPECGEN_TEST_GH_TOKEN ?? "",
        cache: realCache,
      });
      await realFs.resolve();
      expect(realFs.resolvedCommitSha).toMatch(/^[a-f0-9]{40}$/);
    },
  );
});
