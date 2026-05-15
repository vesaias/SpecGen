import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";

export interface SpecGenProjectConfig {
  profile?: string;
  parsers?: string[];
  ai?: {
    provider?: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
    concurrency?: number;
  };
  dataDir?: string;
}

/**
 * Load .specgen/config.yaml from the given root.
 * Returns an empty object if missing or malformed (logs a warning to stderr in the latter case).
 */
export async function loadProjectConfig(rootDir: string): Promise<SpecGenProjectConfig> {
  const configPath = path.join(rootDir, ".specgen", "config.yaml");
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = YAML.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as SpecGenProjectConfig;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    process.stderr.write(`[warn] failed to parse ${configPath}: ${(err as Error).message}\n`);
    return {};
  }
}
