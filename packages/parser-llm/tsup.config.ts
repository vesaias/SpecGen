import { cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  platform: "node",
  target: "node22",
  clean: true,
  onSuccess: async () => {
    // Copy the prompt markdown files alongside the compiled JS so
    // `prompts.ts` can resolve them at runtime in production builds.
    const src = path.resolve("src/prompts");
    const dest = path.resolve("dist/prompts");
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
  },
});
