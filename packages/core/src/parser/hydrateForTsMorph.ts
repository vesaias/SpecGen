import { promises as fs } from "node:fs";
import path from "node:path";
import type { ParserFileSystem } from "./FileSystem.js";

/**
 * Eagerly copies all files that ts-morph + the TypeScript compiler need into
 * a real directory on disk, so they can be loaded normally.
 *
 * Why this exists: `ts-morph` wraps the TypeScript language service, which
 * resolves modules / `tsconfig.json` / `extends` chains by reading files
 * synchronously off the disk. There is no programmatic seam to plug a virtual
 * filesystem in (`ts.System` is settable but `LanguageService` constructs its
 * own host internally for many paths). For `GitHubFs`, where there is no real
 * disk presence, the only robust answer is to hydrate the relevant subset of
 * the repository to a temp dir up front.
 *
 * Files copied:
 *   - `**\/*.ts`, `**\/*.tsx`, `**\/*.d.ts` (configurable via `opts.extensions`)
 *   - `tsconfig.json` / `tsconfig.base.json` at any depth
 *
 * Ignored: `node_modules`, `dist`, `build`, `.next`, `.vite`, `.git`
 *
 * For LocalFs this is a pessimisation — callers should branch on the fs type
 * and skip hydrate when running off a real disk.
 */
export async function hydrateForTsMorph(
  fsys: ParserFileSystem,
  destDir: string,
  opts: { extensions?: string[]; ignore?: string[]; rootRel?: string } = {},
): Promise<string> {
  const exts = opts.extensions ?? [".ts", ".tsx", ".d.ts"];
  const ignore = opts.ignore ?? ["node_modules", "dist", "build", ".next", ".vite", ".git"];
  const tsconfigNames = ["tsconfig.json", "tsconfig.base.json"];
  const rootRel = opts.rootRel ?? "";
  await fs.mkdir(destDir, { recursive: true });

  for await (const entry of fsys.walk(rootRel, { ignore })) {
    if (entry.isDirectory) continue;
    // Strip the rootRel prefix so the destination is rooted at the scope, not
    // at the repo root. This keeps ts-morph's tsconfig + source-file paths
    // consistent when the caller scopes to a sub-directory (e.g. frontendDir).
    const relInScope = rootRel ? entry.path.slice(rootRel.length + 1) : entry.path;
    if (!relInScope) continue;
    const matchExt = exts.some((e) => relInScope.endsWith(e));
    const base = relInScope.split("/").pop() ?? "";
    const matchTsconfig = tsconfigNames.some((n) => base === n);
    if (!matchExt && !matchTsconfig) continue;
    const target = path.join(destDir, relInScope);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const content = await fsys.readFile(entry.path);
    await fs.writeFile(target, content, "utf8");
  }
  return destDir;
}
