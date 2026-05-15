import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vite plugin that handles `node:sqlite` (and similar experimental node built-ins
 * not listed in `builtinModules` without the `node:` prefix).
 * Vite strips the `node:` prefix during resolution for the non-prefixed check;
 * `sqlite` (without prefix) is not in the static builtinModules list, so Vite's
 * default resolver fails to load it. We intercept and return the module content
 * directly.
 */
function nodeExperimentalBuiltins(): Plugin {
  const require = createRequire(import.meta.url);
  // Modules that have `node:` prefix but are NOT in the un-prefixed builtinModules list
  const EXPERIMENTAL_IDS = new Set(["node:sqlite", "sqlite"]);
  return {
    name: "node-experimental-builtins",
    enforce: "pre",
    resolveId(id) {
      if (EXPERIMENTAL_IDS.has(id)) {
        // Return a virtual id that we will handle in `load`
        return `\0node-experimental:${id.replace(/^node:/, "")}`;
      }
    },
    load(id) {
      if (id.startsWith("\0node-experimental:")) {
        const mod = id.slice("\0node-experimental:".length);
        // Re-export everything from the actual node: module
        const actual = require(`node:${mod}`);
        const keys = Object.keys(actual).filter((k) => k !== "default");
        const named = keys.map((k) => `export const ${k} = _mod.${k};`).join("\n");
        return [
          "import { createRequire } from 'node:module';",
          "const _req = createRequire(import.meta.url);",
          `const _mod = _req('node:${mod}');`,
          named,
          "export default _mod;",
        ].join("\n");
      }
    },
  };
}

export default defineConfig({
  plugins: [nodeExperimentalBuiltins()],
  resolve: {
    alias: {
      // Map workspace packages to their TypeScript sources for test runs.
      // This ensures tests always use the latest source, not a potentially stale dist/.
      "@specgen/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@specgen/parser-dotnet": path.resolve(__dirname, "packages/parser-dotnet/src/index.ts"),
      "@specgen/parser-python": path.resolve(__dirname, "packages/parser-python/src/index.ts"),
      "@specgen/parser-react": path.resolve(__dirname, "packages/parser-react/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    // Local-only operator dirs that vitest would otherwise scan for `.spec.tsx` /
    // `.test.ts` patterns. None of these are in git (see .gitignore) — the
    // exclusions just keep `pnpm test` matching CI behaviour locally.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "old code/**",
      "research/**",
      "targets/**",
      "workspaces/**",
    ],
  },
});
