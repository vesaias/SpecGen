import { execSync } from "node:child_process";
import { promises as fs, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { JsonSpecRepository, type SpecRepository } from "@specgen/core";
import simpleGit from "simple-git";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocsPushService } from "../src/DocsPushService.js";
import { DocsPushConflictError } from "../src/types.js";

/**
 * Smoke tests for DocsPushService against a file:// bare repo fixture.
 *
 * No network: all git operations target a local bare repo in tmpdir. If the
 * `git` binary isn't on PATH (rare on Windows CI), the whole suite skips so
 * we don't break the build over an environment issue.
 */
const hasGit = (() => {
  try {
    execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/**
 * On Windows, `file://<drive-letter>:/...` is the canonical form simple-git
 * accepts. mkdtempSync returns drive-letter paths already, so the same URL
 * works on POSIX. We use file:// + forward slashes uniformly.
 */
function fileUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  // On Windows we need `file:///C:/...`, on POSIX `file:///abs/path`.
  if (/^[a-zA-Z]:/.test(normalized)) return `file:///${normalized}`;
  return `file://${normalized}`;
}

describe.skipIf(!hasGit)("DocsPushService against a file:// bare repo", () => {
  let bareRepo: string;
  let cloneDir: string;
  let specDir: string;
  let workingClone: string;
  const tmpDirs: string[] = [];

  beforeEach(async () => {
    bareRepo = mkdtempSync(path.join(tmpdir(), "specgen-bare-"));
    cloneDir = mkdtempSync(path.join(tmpdir(), "specgen-clone-"));
    specDir = mkdtempSync(path.join(tmpdir(), "specgen-spec-"));
    workingClone = mkdtempSync(path.join(tmpdir(), "specgen-init-"));
    tmpDirs.push(bareRepo, cloneDir, specDir, workingClone);

    // mkdtempSync created `cloneDir` already; simple-git's clone wants the
    // destination not to exist. Drop it now — DocsPushService.ensureClone()
    // will create it back.
    await fs.rm(cloneDir, { recursive: true, force: true });

    // Init the bare repo + seed it via a temp working clone.
    execSync("git init --bare", { cwd: bareRepo });

    await fs.rm(workingClone, { recursive: true, force: true });
    await fs.mkdir(workingClone);
    const init = simpleGit(workingClone);
    await init.init();
    await init.checkoutLocalBranch("specgen-docs");
    await fs.writeFile(path.join(workingClone, "README.md"), "# Target\n", "utf8");
    await init.add(["README.md"]);
    await init
      .env({
        GIT_AUTHOR_NAME: "x",
        GIT_AUTHOR_EMAIL: "x@y",
        GIT_COMMITTER_NAME: "x",
        GIT_COMMITTER_EMAIL: "x@y",
      })
      .commit("initial");
    await init.addRemote("origin", fileUrl(bareRepo));
    await init.push("origin", "specgen-docs");
  });

  afterEach(async () => {
    for (const d of tmpDirs.splice(0)) {
      await fs.rm(d, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("clones, materializes spec, commits, and pushes", async () => {
    const repo = new JsonSpecRepository(specDir);
    await repo.write({
      meta: { target: "demo", version: "v1", generatedAt: "2026-05-11" },
      tree: [
        {
          id: "backend",
          type: "folder",
          label: "Backend",
          children: [{ id: "get-foo", type: "backend" as const }],
        },
      ],
      items: { "get-foo": { id: "get-foo", type: "backend", title: "GET /foo" } as any },
    });
    await repo.writeItem({
      id: "get-foo",
      type: "backend",
      title: "GET /foo",
      method: "GET",
      route: "/foo",
      controller: "FooController",
      summary: "",
      context: "",
      parameters: [],
      responses: [],
      validationRules: [],
      orchestration: [],
      dependencies: [],
      sourceFiles: [],
    } as any);

    const svc = new DocsPushService();
    const result = await svc.run(repo, {
      cacheDir: cloneDir,
      cloneUrl: fileUrl(bareRepo),
      targetBranch: "specgen-docs",
      docsRoot: "docs",
      token: "ignored-for-file-protocol",
      author: { name: "SpecGen Bot", email: "specgen@example.com" },
      overwriteStrategy: "halt",
      runId: "test-run-1",
      sourceCommitSha: "abc1234567890",
    });

    expect(result.pushedSha).toBeTruthy();
    expect(result.filesWritten).toBe(1);

    // Token-isolation check: .git/config must NOT contain the token or an
    // AUTHORIZATION header — the http.extraheader trick should be ephemeral.
    const gitConfig = readFileSync(path.join(cloneDir, ".git", "config"), "utf8");
    expect(gitConfig.toLowerCase()).not.toContain("authorization");
    expect(gitConfig.toLowerCase()).not.toContain("extraheader");

    // Verify push landed in the bare repo via a fresh clone.
    const verifyClone = mkdtempSync(path.join(tmpdir(), "specgen-verify-"));
    tmpDirs.push(verifyClone);
    await fs.rm(verifyClone, { recursive: true, force: true });
    await simpleGit().clone(fileUrl(bareRepo), verifyClone);
    await simpleGit(verifyClone).checkout(["specgen-docs"]);
    expect(existsSync(path.join(verifyClone, "docs", "backend", "get-foo.md"))).toBe(true);
    expect(existsSync(path.join(verifyClone, "docs", ".specgen-managed"))).toBe(true);
  });

  it("is idempotent: returns null pushedSha when spec hasn't changed", async () => {
    const repo = new JsonSpecRepository(specDir);
    await repo.write({
      meta: { target: "demo", version: "v1", generatedAt: "2026-05-11" },
      tree: [],
      items: {},
    });
    const svc = new DocsPushService();
    const cfg = {
      cacheDir: cloneDir,
      cloneUrl: fileUrl(bareRepo),
      targetBranch: "specgen-docs",
      docsRoot: "docs",
      token: "ignored",
      author: { name: "x", email: "x@y" },
      overwriteStrategy: "halt" as const,
      runId: "test-run-2",
    };
    const a = await svc.run(repo, cfg);
    // first push creates .specgen-managed → non-null sha
    expect(a.pushedSha).toBeTruthy();
    const b = await svc.run(repo, cfg);
    // second push is a no-op
    expect(b.pushedSha).toBeNull();
  });

  it("rejects items with malicious ids without touching the filesystem", async () => {
    // JsonSpecRepository.writeItem validates ids, so malicious ids can only
    // enter a snapshot via a non-standard SpecRepository implementation.
    // We use a stub repo that injects a malicious id directly into the snapshot
    // to exercise DocsPushService's own id-validation guard.
    const maliciousId = "../etc/passwd";
    const fakeRepo = {
      async snapshot() {
        return {
          spec: {
            meta: { target: "demo", version: "v1", generatedAt: "2026-05-11" },
            tree: [],
            items: {},
          },
          items: { [maliciousId]: { id: maliciousId, type: "backend", title: "evil" } as any },
        };
      },
    };

    const warnings: string[] = [];
    const svc = new DocsPushService();
    const result = await svc.run(fakeRepo as unknown as SpecRepository, {
      cacheDir: cloneDir,
      cloneUrl: fileUrl(bareRepo),
      targetBranch: "specgen-docs",
      docsRoot: "docs",
      token: "ignored-for-file-protocol",
      author: { name: "SpecGen Bot", email: "specgen@example.com" },
      overwriteStrategy: "halt",
      runId: "test-run-malicious-id",
      onWarning: (m) => warnings.push(m),
    });

    // The warning should mention invalid characters.
    expect(warnings.some((w) => w.includes("invalid characters"))).toBe(true);
    // The push should produce 0 spec-item files (only the .specgen-managed marker).
    expect(result.filesWritten).toBe(0);
    // The evil path must not exist on disk anywhere under the clone.
    expect(existsSync(path.join(cloneDir, "etc", "passwd.md"))).toBe(false);
  });

  it("rejects force-push to Main (case-insensitive)", async () => {
    const repo = new JsonSpecRepository(specDir);
    await repo.write({
      meta: { target: "t", version: "v", generatedAt: "2026-01-01" },
      tree: [],
      items: {},
    });
    const svc = new DocsPushService();
    await expect(
      svc.run(repo, {
        cacheDir: cloneDir,
        cloneUrl: fileUrl(bareRepo),
        targetBranch: "Main",
        docsRoot: "docs",
        token: "t",
        author: { name: "x", email: "x@y" },
        overwriteStrategy: "force",
        runId: "test-case",
      }),
    ).rejects.toThrow(/Refusing to force-push/);
  });

  it("throws DocsPushConflictError when remote drifted under halt strategy", async () => {
    const repo = new JsonSpecRepository(specDir);
    await repo.write({
      meta: { target: "demo", version: "v1", generatedAt: "2026-05-11" },
      tree: [],
      items: {},
    });
    const svc = new DocsPushService();
    const cfg = {
      cacheDir: cloneDir,
      cloneUrl: fileUrl(bareRepo),
      targetBranch: "specgen-docs",
      docsRoot: "docs",
      token: "ignored",
      author: { name: "x", email: "x@y" },
      overwriteStrategy: "halt" as const,
      runId: "test-run-3",
      // Doesn't match the real remote — service should refuse to overwrite.
      lastPushedSha: "0000000000000000000000000000000000000000",
    };
    await expect(svc.run(repo, cfg)).rejects.toBeInstanceOf(DocsPushConflictError);
  });
});
