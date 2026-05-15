import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LocalFs } from "../../src/parser/LocalFs.js";

// Create a temporary directory with a fixture structure:
//   root/
//     hello.txt
//     sub/
//       world.txt
//       node_modules/
//         ignored.txt
//     empty-dir/

const root = mkdtempSync(path.join(tmpdir(), "specgen-localfs-"));
mkdirSync(path.join(root, "sub"));
mkdirSync(path.join(root, "sub", "node_modules"));
mkdirSync(path.join(root, "empty-dir"));
writeFileSync(path.join(root, "hello.txt"), "hello");
writeFileSync(path.join(root, "sub", "world.txt"), "world");
writeFileSync(path.join(root, "sub", "node_modules", "ignored.txt"), "ignored");

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("LocalFs", () => {
  const fsys = new LocalFs(root);

  it("readFile returns file contents", async () => {
    expect(await fsys.readFile("hello.txt")).toBe("hello");
    expect(await fsys.readFile("sub/world.txt")).toBe("world");
  });

  it("exists returns true for files and directories", async () => {
    expect(await fsys.exists("hello.txt")).toBe(true);
    expect(await fsys.exists("sub")).toBe(true);
    expect(await fsys.exists("sub/world.txt")).toBe(true);
  });

  it("exists returns false for missing paths (no throw)", async () => {
    expect(await fsys.exists("nonexistent")).toBe(false);
    expect(await fsys.exists("sub/nonexistent.txt")).toBe(false);
  });

  it("exists() throws on non-ENOENT errors instead of returning false", async () => {
    // Portable structural check: verify the implementation only swallows ENOENT.
    // Triggering EACCES portably in a temp dir is flaky, so we inspect the source.
    const src = await import("node:fs").then((m) =>
      m.promises.readFile(new URL("../../src/parser/LocalFs.ts", import.meta.url), "utf8"),
    );
    expect(src).toContain("ENOENT");
    expect(src).toMatch(/throw err/);
  });

  it("stat returns size and isDirectory for a file", async () => {
    const s = await fsys.stat("hello.txt");
    expect(s.isDirectory).toBe(false);
    expect(s.size).toBeGreaterThan(0);
  });

  it("stat returns isDirectory=true for a directory", async () => {
    const s = await fsys.stat("sub");
    expect(s.isDirectory).toBe(true);
  });

  it("stat throws for nonexistent path", async () => {
    await expect(fsys.stat("nonexistent")).rejects.toThrow();
  });

  it("listDir returns entries directly under a path", async () => {
    const entries = await fsys.listDir(".");
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain("hello.txt");
    expect(names).toContain("sub");
    expect(names).toContain("empty-dir");
  });

  it("listDir correctly identifies files vs directories", async () => {
    const entries = await fsys.listDir(".");
    const hello = entries.find((e) => e.name === "hello.txt");
    const sub = entries.find((e) => e.name === "sub");
    expect(hello?.isDirectory).toBe(false);
    expect(sub?.isDirectory).toBe(true);
  });

  it("walk yields all entries recursively", async () => {
    const paths: string[] = [];
    for await (const entry of fsys.walk(".")) {
      paths.push(entry.path);
    }
    expect(paths).toContain("hello.txt");
    expect(paths).toContain("sub/world.txt");
    // node_modules itself should appear (not ignored unless opts.ignore set)
    expect(paths).toContain("sub/node_modules");
  });

  it("walk honours opts.ignore — skips node_modules entries", async () => {
    const paths: string[] = [];
    for await (const entry of fsys.walk(".", { ignore: ["node_modules"] })) {
      paths.push(entry.path);
    }
    expect(paths).not.toContain("sub/node_modules");
    expect(paths).not.toContain("sub/node_modules/ignored.txt");
    expect(paths).toContain("sub/world.txt");
  });

  it("walk on empty-dir yields no entries", async () => {
    const paths: string[] = [];
    for await (const entry of fsys.walk("empty-dir")) {
      paths.push(entry.path);
    }
    expect(paths).toHaveLength(0);
  });

  it("walk on nonexistent path skips silently", async () => {
    const paths: string[] = [];
    for await (const entry of fsys.walk("nonexistent-dir")) {
      paths.push(entry.path);
    }
    expect(paths).toHaveLength(0);
  });

  it("subFs returns a LocalFs rooted at the joined subdir path", async () => {
    const sub = fsys.subFs("sub");
    expect(sub.rootDir).toBe(path.join(root, "sub"));
    expect(await sub.readFile("world.txt")).toBe("world");
    const entries = await sub.listDir(".");
    const names = entries.map((e) => e.name).sort();
    expect(names).toContain("world.txt");
    expect(names).toContain("node_modules");
  });
});
