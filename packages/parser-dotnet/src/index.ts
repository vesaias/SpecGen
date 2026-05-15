import type {
  DetectInput,
  DetectResult,
  ParseInput,
  ParseResult,
  ParserPlugin,
} from "@specgen/core";
import { parseBackend, parseEvents } from "./parseBackend.js";

export const dotnetParser: ParserPlugin = {
  id: "dotnet",
  name: ".NET (C#) Backend Parser",

  async detect(input: DetectInput): Promise<DetectResult> {
    // Heuristic: look for *.csproj files or a "Controllers/" directory
    const subDirs: string[] = [];
    let confidence = 0;
    try {
      const entries = await input.fs.listDir(".");
      for (const e of entries) {
        if (!e.isDirectory && e.name.endsWith(".csproj")) confidence = Math.max(confidence, 0.9);
        if (e.isDirectory && e.name.toLowerCase() === "controllers") {
          confidence = Math.max(confidence, 0.95);
          subDirs.push(`${input.rootDir}/controllers`);
        }
      }
    } catch {
      // ENOENT or permission issue: leave confidence 0
    }
    return { confidence, subDirs };
  },

  async parse(input: ParseInput): Promise<ParseResult> {
    const endpoints = await parseBackend(input.rootDir, input.fs);
    const events = await parseEvents(input.rootDir, input.fs);
    return { endpoints, events, warnings: [] };
  },
};

export default dotnetParser;
export { parseBackend, parseEvents } from "./parseBackend.js";
