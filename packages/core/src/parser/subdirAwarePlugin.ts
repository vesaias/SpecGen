import path from "node:path";
import type { ParserFileSystem } from "./FileSystem.js";
import type { ParserPlugin } from "./Parser.js";
import type { DetectInput, DetectResult, ParseInput, ParseResult } from "./types.js";

/**
 * Wraps a parser so detect+parse re-try against immediate child directories
 * when the root-level detection returns confidence 0. Lets layouts like
 * MockPMS's backend/+frontend/ siblings work without operator intervention.
 *
 * Critical: the subdir retries go through the SAME ParserFileSystem the
 * caller passed in, just with a different root — produced by the filesystem's
 * own `subFs(name)` method. This works for LocalFs (joined disk path) and
 * GitHubFs (virtual subtree-rooted view, no extra API calls) alike.
 */
export function subdirAwarePlugin(plugin: ParserPlugin): ParserPlugin {
  async function listSubdirs(parentFs: ParserFileSystem): Promise<string[]> {
    try {
      const entries = await parentFs.listDir("");
      return entries.filter((e) => e.isDirectory).map((e) => e.name);
    } catch {
      return [];
    }
  }

  return {
    ...plugin,
    async detect(input: DetectInput): Promise<DetectResult> {
      const direct = await plugin.detect(input);
      if (direct.confidence > 0) return direct;
      for (const name of await listSubdirs(input.fs)) {
        const subFs = input.fs.subFs(name);
        const subRootDir = path.join(input.rootDir, name);
        const r = await plugin.detect({ rootDir: subRootDir, fs: subFs });
        if (r.confidence > 0) return r;
      }
      return direct;
    },
    async parse(input: ParseInput): Promise<ParseResult> {
      const direct = await plugin.detect({ rootDir: input.rootDir, fs: input.fs });
      if (direct.confidence > 0) return plugin.parse(input);
      for (const name of await listSubdirs(input.fs)) {
        const subFs = input.fs.subFs(name);
        const subRootDir = path.join(input.rootDir, name);
        const r = await plugin.detect({ rootDir: subRootDir, fs: subFs });
        if (r.confidence > 0) return plugin.parse({ ...input, rootDir: subRootDir, fs: subFs });
      }
      return plugin.parse(input);
    },
  };
}
