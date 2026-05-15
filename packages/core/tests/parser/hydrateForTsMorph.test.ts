import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ParserFileSystem } from "../../src/parser/FileSystem.js";
import { hydrateForTsMorph } from "../../src/parser/hydrateForTsMorph.js";

/**
 * In-memory ParserFileSystem for tests. The `MockFs` implementation here is
 * intentionally minimal — only the methods hydrate actually uses (walk +
 * readFile) are wired; the rest throw.
 */
class MockFs implements ParserFileSystem {
  readonly rootDir = "/";

  constructor(private readonly files: Map<string, string>) {}

  async readFile(rel: string): Promise<string> {
    const norm = rel.replace(/^\/+/, "");
    const v = this.files.get(norm);
    if (v === undefined) {
      throw Object.assign(new Error(`Missing: ${rel}`), { code: "ENOENT" });
    }
    return v;
  }

  async exists(rel: string): Promise<boolean> {
    return this.files.has(rel.replace(/^\/+/, ""));
  }

  async stat(rel: string) {
    const v = this.files.get(rel.replace(/^\/+/, ""));
    if (v === undefined) throw new Error(`Missing: ${rel}`);
    return { size: v.length, isDirectory: false };
  }

  async listDir(): Promise<Array<{ name: string; isDirectory: boolean }>> {
    throw new Error("not implemented");
  }

  async *walk(
    rel: string,
    opts: { ignore?: string[] } = {},
  ): AsyncIterable<{ path: string; isDirectory: boolean }> {
    const ignoreSet = new Set(opts.ignore ?? []);
    const norm = rel.replace(/^\/+|\/+$/g, "");
    const prefix = norm ? `${norm}/` : "";
    for (const p of this.files.keys()) {
      if (prefix && !p.startsWith(prefix)) continue;
      if (p.split("/").some((s) => ignoreSet.has(s))) continue;
      yield { path: p, isDirectory: false };
    }
  }
}

describe("hydrateForTsMorph", () => {
  let dest: string;

  beforeEach(() => {
    dest = mkdtempSync(path.join(tmpdir(), "specgen-hydrate-"));
  });

  afterEach(() => {
    rmSync(dest, { recursive: true, force: true });
  });

  it("copies .ts, .tsx, .d.ts, and tsconfig.json into the dest dir", async () => {
    const files = new Map([
      ["tsconfig.json", '{"compilerOptions":{}}'],
      ["src/main.ts", "export const x = 1;"],
      ["src/App.tsx", "export default () => null;"],
      ["src/types.d.ts", "declare module 'foo';"],
      ["README.md", "# this should be skipped"],
      ["package.json", "{}"],
    ]);
    const fsys = new MockFs(files);
    const result = await hydrateForTsMorph(fsys, dest);
    expect(result).toBe(dest);
    expect(readFileSync(path.join(dest, "tsconfig.json"), "utf8")).toBe('{"compilerOptions":{}}');
    expect(readFileSync(path.join(dest, "src/main.ts"), "utf8")).toBe("export const x = 1;");
    expect(readFileSync(path.join(dest, "src/App.tsx"), "utf8")).toContain("default");
    expect(readFileSync(path.join(dest, "src/types.d.ts"), "utf8")).toContain("declare");
    expect(existsSync(path.join(dest, "README.md"))).toBe(false);
    expect(existsSync(path.join(dest, "package.json"))).toBe(false);
  });

  it("skips ignored directories", async () => {
    const files = new Map([
      ["src/main.ts", "x"],
      ["node_modules/lib/dist.ts", "x"],
      ["dist/build.ts", "x"],
      [".next/cache/foo.ts", "x"],
      [".git/HEAD", "ref:..."],
    ]);
    const fsys = new MockFs(files);
    await hydrateForTsMorph(fsys, dest);
    expect(existsSync(path.join(dest, "src/main.ts"))).toBe(true);
    expect(existsSync(path.join(dest, "node_modules/lib/dist.ts"))).toBe(false);
    expect(existsSync(path.join(dest, "dist/build.ts"))).toBe(false);
    expect(existsSync(path.join(dest, ".next/cache/foo.ts"))).toBe(false);
  });

  it("hydrates tsconfig.base.json alongside tsconfig.json", async () => {
    const files = new Map([
      ["tsconfig.json", "{}"],
      ["tsconfig.base.json", "{}"],
      ["packages/foo/tsconfig.json", "{}"],
    ]);
    const fsys = new MockFs(files);
    await hydrateForTsMorph(fsys, dest);
    expect(existsSync(path.join(dest, "tsconfig.json"))).toBe(true);
    expect(existsSync(path.join(dest, "tsconfig.base.json"))).toBe(true);
    expect(existsSync(path.join(dest, "packages/foo/tsconfig.json"))).toBe(true);
  });

  it("honours custom extensions option", async () => {
    const files = new Map([
      ["src/main.js", "let x = 1;"],
      ["src/main.ts", "const x = 1;"],
    ]);
    const fsys = new MockFs(files);
    await hydrateForTsMorph(fsys, dest, { extensions: [".js"] });
    expect(existsSync(path.join(dest, "src/main.js"))).toBe(true);
    expect(existsSync(path.join(dest, "src/main.ts"))).toBe(false);
  });

  it("creates the dest dir if it doesn't exist", async () => {
    const nested = path.join(dest, "deep", "nested");
    const files = new Map([["a.ts", "x"]]);
    const fsys = new MockFs(files);
    await hydrateForTsMorph(fsys, nested);
    expect(existsSync(path.join(nested, "a.ts"))).toBe(true);
  });

  it("handles an empty filesystem gracefully", async () => {
    const fsys = new MockFs(new Map());
    await hydrateForTsMorph(fsys, dest);
    // dest should still exist but be empty
    expect(existsSync(dest)).toBe(true);
  });

  it("scopes walk to rootRel and strips the prefix from destination paths", async () => {
    const files = new Map([
      ["backend/x.cs", "// ignored"],
      ["frontend/tsconfig.json", "{}"],
      ["frontend/src/App.tsx", "export const App = () => null;"],
      ["frontend/src/lib.ts", "export const x = 1;"],
      ["tools/script.ts", "// also ignored"],
    ]);
    const fsys = new MockFs(files);
    const out = await hydrateForTsMorph(fsys, dest, { rootRel: "frontend" });
    // Dest is returned unchanged
    expect(out).toBe(dest);
    // Files within the scope are present, with the rootRel prefix stripped
    expect(existsSync(path.join(out, "tsconfig.json"))).toBe(true);
    expect(existsSync(path.join(out, "src", "App.tsx"))).toBe(true);
    expect(existsSync(path.join(out, "src", "lib.ts"))).toBe(true);
    // Files outside the scope must NOT be copied
    expect(existsSync(path.join(out, "backend", "x.cs"))).toBe(false);
    expect(existsSync(path.join(out, "tools", "script.ts"))).toBe(false);
    // The rootRel directory itself must not appear as a prefix in dest
    expect(existsSync(path.join(out, "frontend", "tsconfig.json"))).toBe(false);
  });
});
