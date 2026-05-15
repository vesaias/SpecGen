import path from "node:path";
import type {
  DetectInput,
  DetectResult,
  ParseInput,
  ParseResult,
  ParserPlugin,
} from "@specgen/core";
import { parseFrontend } from "./parseFrontend.js";

export const reactParser: ParserPlugin = {
  id: "react",
  name: "React (TypeScript) Frontend Parser",

  async detect(input: DetectInput): Promise<DetectResult> {
    let confidence = 0;
    const subDirs: string[] = [];
    try {
      const pkgContent = await input.fs.readFile("package.json");
      const pkg = JSON.parse(pkgContent) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.react) confidence = 0.9;
    } catch {
      // ENOENT — skip
    }
    try {
      const srcStat = await input.fs.stat("src");
      if (srcStat.isDirectory) subDirs.push(path.join(input.rootDir, "src"));
    } catch {
      // ENOENT — skip
    }
    return { confidence, subDirs };
  },

  async parse(input: ParseInput): Promise<ParseResult> {
    const pages = await parseFrontend(input.rootDir, input.fs);
    return { pages, warnings: [] };
  },
};

export default reactParser;
export { parseFrontend } from "./parseFrontend.js";
