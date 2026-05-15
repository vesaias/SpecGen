import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GitHubBlobCache, GitHubFs, ParserRegistry, subdirAwarePlugin } from "@specgen/core";
import type { OctokitLike } from "@specgen/core";
import { dotnetParser } from "@specgen/parser-dotnet";
import { reactParser } from "@specgen/parser-react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { probeProject } from "../../src/services/probeProject.js";

/**
 * Regression coverage for the GitHub-source probe bug: before subFs() landed
 * on every ParserFileSystem, subdirAwarePlugin built a LocalFs at "/backend"
 * (the host root!) when probing a GitHubFs, returning confidence 0 for every
 * parser. This test verifies the dotnet parser now matches a classic
 * backend/+frontend/ GitHub layout via the GitHubSubFs view.
 */

function makeMockOctokit(files: Record<string, { sha: string; content: string }>): OctokitLike {
  const blobs = new Map<string, string>();
  const tree: Array<{ path: string; type: "blob" | "tree"; sha: string; size: number }> = [];
  const dirs = new Set<string>();
  for (const [p, { sha, content }] of Object.entries(files)) {
    blobs.set(sha, content);
    tree.push({ path: p, type: "blob", sha, size: content.length });
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) {
      dirs.add(parts.slice(0, i).join("/"));
    }
  }
  for (const d of dirs) {
    tree.push({ path: d, type: "tree", sha: `dir-${d}`, size: 0 });
  }
  return {
    rest: {
      repos: {
        getCommit: async () => ({ data: { sha: "commit-abc" } }),
      },
      git: {
        getTree: async () => ({ data: { truncated: false, tree } }),
        getBlob: async ({ file_sha }) => {
          const content = blobs.get(file_sha);
          if (!content) throw new Error(`unknown sha ${file_sha}`);
          return {
            data: {
              content: Buffer.from(content, "utf8").toString("base64"),
              encoding: "base64",
            },
          };
        },
      },
    },
  };
}

describe("probeProject (GitHub source)", () => {
  let cacheDir: string;
  let cache: GitHubBlobCache;

  beforeEach(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), "specgen-probe-gh-"));
    cache = new GitHubBlobCache(cacheDir);
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("matches dotnet parser inside backend/ for a backend/+frontend/ layout", async () => {
    const octokit = makeMockOctokit({
      "backend/MyApp.csproj": { sha: "csproj", content: "<Project/>" },
      "backend/Controllers/HomeController.cs": {
        sha: "ctrl",
        content: "namespace X; public class HomeController {}",
      },
      "frontend/package.json": {
        sha: "pkg",
        content: '{"name":"fe","dependencies":{"react":"18"}}',
      },
      "README.md": { sha: "rm", content: "# repo" },
    });

    const parsers = new ParserRegistry();
    parsers.register(subdirAwarePlugin(dotnetParser));
    parsers.register(subdirAwarePlugin(reactParser));

    const buildGitHubFs = () =>
      new GitHubFs({
        owner: "v-es99",
        repo: "MockPMS",
        ref: "main",
        token: "",
        cache,
        octokit,
      });

    const report = await probeProject(
      {
        source: {
          type: "github",
          owner: "v-es99",
          repo: "MockPMS",
          ref: "main",
          token: "stub",
        },
      },
      parsers,
      buildGitHubFs,
    );

    expect(report.canParse).toBe(true);
    const dotnetMatch = report.matches.find((m) => m.parser === "dotnet");
    expect(dotnetMatch).toBeTruthy();
    expect(dotnetMatch?.confidence).toBeGreaterThan(0);
  });

  it("rejection.lookedAt reflects actual immediate subdirs, not a hardcoded list", async () => {
    // Repo with a single Go file in a weird-named dir — no parser matches,
    // and we want lookedAt to show "/" + "weirddir/", not the old copy-pasta
    // ["/", "backend/", "frontend/", "src/", "client/", "server/"].
    const octokit = makeMockOctokit({
      "weirddir/main.go": { sha: "go", content: "package main\nfunc main(){}\n" },
    });

    const parsers = new ParserRegistry();
    parsers.register(subdirAwarePlugin(dotnetParser));
    parsers.register(subdirAwarePlugin(reactParser));

    const report = await probeProject(
      {
        source: {
          type: "github",
          owner: "a",
          repo: "b",
          ref: "main",
          token: "stub",
        },
      },
      parsers,
      () =>
        new GitHubFs({
          owner: "a",
          repo: "b",
          ref: "main",
          token: "",
          cache,
          octokit,
        }),
    );

    expect(report.canParse).toBe(false);
    expect(report.rejected.length).toBeGreaterThan(0);
    for (const rej of report.rejected) {
      expect(rej.lookedAt).toContain("/");
      expect(rej.lookedAt).toContain("weirddir/");
      // Old hardcoded entries that don't exist in this repo should NOT appear
      expect(rej.lookedAt).not.toContain("backend/");
      expect(rej.lookedAt).not.toContain("frontend/");
    }
  });
});
