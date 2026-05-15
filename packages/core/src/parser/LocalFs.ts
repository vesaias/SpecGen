import { promises as fs } from "node:fs";
import path from "node:path";
import type { ParserFileSystem } from "./FileSystem.js";

export class LocalFs implements ParserFileSystem {
  constructor(public readonly rootDir: string) {}

  async readFile(rel: string): Promise<string> {
    return fs.readFile(path.join(this.rootDir, rel), "utf8");
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.rootDir, rel));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
  }

  async stat(rel: string) {
    const s = await fs.stat(path.join(this.rootDir, rel));
    return { size: s.size, isDirectory: s.isDirectory() };
  }

  async listDir(rel: string) {
    const entries = await fs.readdir(path.join(this.rootDir, rel), { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  }

  subFs(relPath: string): ParserFileSystem {
    return new LocalFs(path.join(this.rootDir, relPath));
  }

  async *walk(
    rel: string,
    opts: { ignore?: string[] } = {},
  ): AsyncIterable<{ path: string; isDirectory: boolean }> {
    const ignoreSet = new Set(opts.ignore ?? []);
    // Normalise the start: "." → "" so paths come out as "foo/bar" not "./foo/bar"
    const startDir = rel === "." || rel === "" ? "" : rel;
    const stack: string[] = [startDir];
    while (stack.length) {
      const dir = stack.pop() ?? "";
      let entries: Array<{ name: string; isDirectory: boolean }>;
      try {
        // listDir uses fs.rootDir join; pass "." when dir is empty
        entries = await this.listDir(dir === "" ? "." : dir);
      } catch {
        continue; // dir doesn't exist — skip
      }
      for (const e of entries) {
        // ignore matching: any path segment equals an ignore entry
        if (ignoreSet.has(e.name)) continue;
        const full = dir ? `${dir}/${e.name}` : e.name;
        yield { path: full, isDirectory: e.isDirectory };
        if (e.isDirectory) stack.push(full);
      }
    }
  }
}
