/**
 * Prompt loader.
 *
 * Prompts live alongside the compiled JS as `.md` files. Tsup copies them
 * into `dist/prompts/` via the `loader` option, but for safety we resolve
 * them relative to the module's directory using `import.meta.url` and fall
 * back to the source-tree path during dev/tests (where `dist/` doesn't
 * exist yet).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function loadPrompt(name: string): string {
  // 1. Try alongside the compiled output (dist/prompts/<name>.md).
  const candidates = [
    path.resolve(here, "prompts", name),
    // 2. Fall back to the source tree (tests / tsx watch).
    path.resolve(here, "..", "src", "prompts", name),
    path.resolve(here, "..", "..", "src", "prompts", name),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      // try next
    }
  }
  throw new Error(`@specgen/parser-llm: prompt file not found: ${name}`);
}

let backendCache: string | null = null;
let frontendCache: string | null = null;

export function backendPrompt(): string {
  if (backendCache === null) backendCache = loadPrompt("backend-extract.md");
  return backendCache;
}

export function frontendPrompt(): string {
  if (frontendCache === null) frontendCache = loadPrompt("frontend-extract.md");
  return frontendCache;
}
