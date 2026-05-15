/**
 * Lightweight, language-agnostic heuristics for classifying a source file
 * before we pay an AI call on it.
 *
 * Goal: cheaply decide "is this file likely a backend handler, a frontend
 * page, or noise we should skip" without parsing the AST. The heuristics are
 * intentionally loose — false positives just cost an AI call that returns
 * `{ endpoints: [], events: [], pages: [] }`, while false negatives lose
 * coverage. We err toward inclusion.
 */

export type FileKind = "backend" | "frontend" | "skip";

const SOURCE_EXTS = new Set([
  ".py",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".cs",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
]);

/** Top-level / segment ignore matches that `ParserFileSystem.walk` honours. */
export const IGNORE_DIRS = [
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".vercel",
  ".output",
  "out",
  ".turbo",
  ".cache",
  "coverage",
  "__pycache__",
  "venv",
  ".venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  "target", // rust
  "bin", // .NET
  "obj", // .NET
  ".idea",
  ".vscode",
];

/** Frontend-flavoured path hints — match any segment. */
const FRONTEND_HINTS = [
  "pages",
  "page",
  "routes",
  "screens",
  "views",
  "components/pages",
  "app", // next.js app router
  "frontend", // monorepos with a top-level frontend/ directory
  "webapp",
  "client",
  "ui",
  "web",
];

/** Backend-flavoured path hints — match any segment. */
const BACKEND_HINTS = [
  "controllers",
  "controller",
  "routes",
  "route",
  "handlers",
  "handler",
  "api",
  "endpoints",
  "endpoint",
  "resolvers", // graphql
  "services",
  "router",
  "routers",
  "backend",
  "server",
];

export function isSourceFile(relPath: string): boolean {
  const i = relPath.lastIndexOf(".");
  if (i < 0) return false;
  return SOURCE_EXTS.has(relPath.slice(i).toLowerCase());
}

/**
 * Best-effort guess at what an AI call on this file would produce. Used to
 * route the file to the backend or frontend prompt.
 *
 * Rules of thumb (cheap, deterministic):
 *  - `.tsx` / `.jsx` files are very likely frontend.
 *  - `.cs` / `.go` / `.rs` / `.java` / `.rb` / `.php` are very likely backend.
 *  - For `.ts` / `.js` / `.py` we look at path segments — `pages/`, `routes/`,
 *    `views/`, etc. point to frontend; `controllers/`, `handlers/`, `api/`
 *    point to backend.
 *  - Files in `tests/`, `__tests__/`, `*.test.*`, `*.spec.*` are skipped.
 *  - `.d.ts` files are skipped.
 */
export function classifyFile(relPath: string): FileKind {
  const lower = relPath.toLowerCase().replace(/\\/g, "/");
  if (lower.endsWith(".d.ts")) return "skip";
  if (/(^|\/)__tests__\//.test(lower)) return "skip";
  if (/(^|\/)tests?\//.test(lower)) return "skip";
  if (/\.(test|spec)\.[a-z]+$/.test(lower)) return "skip";
  if (/(^|\/)__mocks__\//.test(lower)) return "skip";
  if (lower.endsWith(".min.js")) return "skip";

  const i = lower.lastIndexOf(".");
  if (i < 0) return "skip";
  const ext = lower.slice(i);
  if (!SOURCE_EXTS.has(ext)) return "skip";

  // Unambiguous-by-extension languages
  if (ext === ".tsx" || ext === ".jsx") return "frontend";
  if (ext === ".cs" || ext === ".go" || ext === ".rs" || ext === ".java") return "backend";
  if (ext === ".rb" || ext === ".php") return "backend";

  // Ambiguous: .py, .ts, .js — fall back to path hints.
  const segments = lower.split("/");
  for (const hint of FRONTEND_HINTS) {
    if (segments.some((s) => s === hint)) return "frontend";
  }
  for (const hint of BACKEND_HINTS) {
    if (segments.some((s) => s === hint)) return "backend";
  }

  // .py without a frontend hint → backend by default.
  if (ext === ".py") return "backend";

  // .ts / .js without any strong signal: default to backend. If the file is
  // a React component it'll usually be .tsx/.jsx; plain .ts in a frontend
  // project is more often a hook / util than a page.
  return "backend";
}
