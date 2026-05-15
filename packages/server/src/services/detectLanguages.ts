import type { ParserFileSystem } from "@specgen/core";

const EXT_TO_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cs": "csharp",
  ".csproj": "csharp",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
};

/**
 * Which parser id ships for each language. Used to populate the
 * `parserAvailable` hint in the DetectReport.
 */
const PARSER_AVAILABLE: Record<string, string> = {
  typescript: "parser-react",
  csharp: "parser-dotnet",
  python: "parser-python",
};

/**
 * Walk the filesystem and tally files by extension.
 *
 * Returns an array sorted by file count (desc) with a `parserAvailable` flag
 * indicating whether a shipped parser handles that language.
 *
 * Capped at 5 000 entries so a giant monorepo probe finishes in <100 ms.
 */
export async function detectLanguages(
  fs: ParserFileSystem,
): Promise<Array<{ language: string; fileCount: number; parserAvailable: boolean }>> {
  const counts = new Map<string, number>();
  let total = 0;
  for await (const entry of fs.walk("", {
    ignore: [
      "node_modules",
      "dist",
      "build",
      ".git",
      ".next",
      ".vite",
      "venv",
      ".venv",
      "__pycache__",
      "target",
      "bin",
      "obj",
    ],
  })) {
    if (entry.isDirectory) continue;
    total++;
    if (total > 5000) break; // cap to keep probe fast
    const dotIdx = entry.path.lastIndexOf(".");
    if (dotIdx === -1) continue;
    const ext = entry.path.slice(dotIdx);
    const lang = EXT_TO_LANG[ext];
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([language, fileCount]) => ({
      language,
      fileCount,
      parserAvailable: PARSER_AVAILABLE[language] !== undefined,
    }));
}
