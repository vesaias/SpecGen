import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "tsup";

export default defineConfig({
  // index.ts — the library entry consumed by other packages and tests.
  // serve.ts — the production HTTP entry; `node dist/serve.js` boots the API.
  entry: ["src/index.ts", "src/serve.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  platform: "node",
  target: "node22",
  // esbuild strips the "node:" prefix on externals; restore it post-build.
  external: ["node:sqlite"],
  clean: true,
  async onSuccess() {
    // Restore canonical `from "node:sqlite"` on every .js file under dist/.
    // tsup splits shared code into chunk-*.js files, so a per-entry fix isn't
    // enough — we sweep the whole dist directory.
    if (existsSync("dist")) {
      const files = readdirSync("dist").filter((f) => f.endsWith(".js"));
      for (const f of files) {
        const file = path.join("dist", f);
        const src = readFileSync(file, "utf8");
        const fixed = src.replace(/from "sqlite"/g, 'from "node:sqlite"');
        if (fixed !== src) {
          writeFileSync(file, fixed, "utf8");
          console.log(`[tsup] Restored node: prefix in ${file}`);
        }
      }
    }
    // Copy migrations alongside the built serve.js — serve.ts resolves them
    // relative to its own dirname (dist/db/migrations after build).
    if (existsSync("src/db/migrations")) {
      cpSync("src/db/migrations", "dist/db/migrations", { recursive: true });
      console.log("[tsup] Copied db/migrations into dist/");
    }
  },
});
