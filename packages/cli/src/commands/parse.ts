import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  GeneratorRegistry,
  JsonSpecRepository,
  LocalFs,
  ParserRegistry,
  ProfileLoader,
  confluencePushGenerator,
  enrichmentPipelineGenerator,
  frontendCaptureGenerator,
  fullTreeSpecGenerator,
  projectBootstrapGenerator,
  smartTreeGenerator,
  subdirAwarePlugin,
} from "@specgen/core";
import type { ParserFileSystem, Spec, SpecItem, SpecRepository } from "@specgen/core";
import { dotnetParser } from "@specgen/parser-dotnet";
import { pythonParser } from "@specgen/parser-python";
import { reactParser } from "@specgen/parser-react";
import { buildAiRouter } from "../services/aiClientFactory.js";
import { detectProvider } from "../services/detectProvider.js";
import { loadProjectConfig } from "../services/loadConfig.js";

// ---------------------------------------------------------------------------
// NullSpecRepository — no-ops all write operations, used for --dry-run
// ---------------------------------------------------------------------------

class NullSpecRepository implements SpecRepository {
  async read(): Promise<Spec | null> {
    return null;
  }
  async write(_spec: Spec): Promise<void> {
    // dry-run: no-op
  }
  async readItem(_id: string): Promise<SpecItem | null> {
    return null;
  }
  async writeItem(_item: SpecItem): Promise<void> {
    // dry-run: no-op
  }
  async deleteItem(_id: string): Promise<void> {
    // dry-run: no-op
  }
  async listItemIds(): Promise<string[]> {
    return [];
  }
  async snapshot(): Promise<never> {
    throw new Error("snapshot() not supported in --dry-run mode");
  }
}

// ---------------------------------------------------------------------------
// Command interface
// ---------------------------------------------------------------------------

export interface ParseOptions {
  root?: string;
  dataDir?: string;
  profile?: string;
  generator?: string;
  quiet?: boolean;
  dryRun?: boolean;
  /** Override for tests — absolute path to the packaged profiles directory */
  packagedProfilesDir?: string;
  /** Explicit AI provider override: local | claude_api | claude_code | openai | openai_compat | ollama */
  provider?: string;
}

export interface CliParseResult {
  status: "success" | "error";
  itemsCreated: number;
  itemsUpdated: number;
  itemsRemoved: number;
  warnings: number;
  message?: string;
}

// ---------------------------------------------------------------------------
// Command implementation
// ---------------------------------------------------------------------------

export async function parseCommand(opts: ParseOptions = {}): Promise<CliParseResult> {
  const root = path.resolve(opts.root ?? process.cwd());
  const config = await loadProjectConfig(root);
  const profileId = opts.profile ?? config.profile ?? "pm-spec";
  const generatorId = opts.generator ?? "full-tree-spec";
  const dataDir = path.resolve(
    opts.dataDir ?? config.dataDir ?? path.join(root, ".specgen", "data"),
  );

  const log = (msg: string) => {
    if (!opts.quiet) process.stdout.write(`${msg}\n`);
  };

  if (opts.dryRun) {
    log("[dry-run] no files will be written");
  }

  log(`[specgen] parsing ${root}`);
  log(`[specgen] profile: ${profileId}, generator: ${generatorId}, dataDir: ${dataDir}`);

  // Resolve the packaged profiles dir.
  // TODO: revisit packaging in Phase E — use import.meta.resolve('@specgen/core/profiles') or similar.
  const packagedProfilesDir = opts.packagedProfilesDir ?? findPackagedProfilesDir();
  const profileLoader = new ProfileLoader({ packagedRoot: packagedProfilesDir });
  const profile = await profileLoader.load(profileId, root);

  const parserRegistry = new ParserRegistry();
  parserRegistry.register(subdirAwarePlugin(dotnetParser));
  parserRegistry.register(subdirAwarePlugin(pythonParser));
  parserRegistry.register(subdirAwarePlugin(reactParser));

  const generatorRegistry = new GeneratorRegistry();
  generatorRegistry.register(fullTreeSpecGenerator);
  generatorRegistry.register(projectBootstrapGenerator);
  generatorRegistry.register(smartTreeGenerator);
  generatorRegistry.register(enrichmentPipelineGenerator);
  generatorRegistry.register(frontendCaptureGenerator);
  generatorRegistry.register(confluencePushGenerator);

  const generator = generatorRegistry.get(generatorId);
  if (!generator) {
    return {
      status: "error",
      itemsCreated: 0,
      itemsUpdated: 0,
      itemsRemoved: 0,
      warnings: 0,
      message: `Unknown generator: ${generatorId}`,
    };
  }

  const spec: SpecRepository = opts.dryRun
    ? new NullSpecRepository()
    : new JsonSpecRepository(dataDir);

  let itemsCreated = 0;
  let itemsUpdated = 0;
  let itemsRemoved = 0;
  let warnings = 0;
  let errored: Error | undefined;

  const detection = await detectProvider(opts.provider, config.ai?.provider);
  const ai = buildAiRouter({
    provider: detection.provider,
    model: config.ai?.model ?? defaultModelFor(detection.provider),
    apiKey: config.ai?.apiKey,
    baseUrl: config.ai?.baseUrl,
  });

  if (detection.reason === "local-fallback" && !opts.quiet) {
    process.stderr.write(
      "[specgen] No AI provider configured — using local stub (placeholders will not be enriched).\n" +
        "          Install Claude Code or set ANTHROPIC_API_KEY / OPENAI_API_KEY for real enrichment.\n",
    );
  }
  log(`[specgen] ai provider: ${detection.provider} (${detection.reason})`);

  const parserFs: ParserFileSystem = new LocalFs(root);

  for await (const event of generator.run({
    rootDir: root,
    fs: parserFs,
    profile,
    parsers: parserRegistry,
    spec,
    ai,
  })) {
    switch (event.type) {
      case "progress":
        log(`  ${event.message}`);
        break;
      case "item-updated":
        log(`  + ${event.itemId}`);
        break;
      case "warning":
        warnings += 1;
        log(`  [warn] ${event.message}`);
        break;
      case "error":
        errored = event.error;
        log(`  [error] ${event.error.message}`);
        break;
      case "done":
        itemsCreated = event.stats.itemsCreated;
        itemsUpdated = event.stats.itemsUpdated;
        itemsRemoved = event.stats.itemsRemoved;
        warnings = event.stats.warnings;
        log(
          `[specgen] done: +${itemsCreated} ~${itemsUpdated} -${itemsRemoved} (${warnings} warnings)`,
        );
        break;
    }
  }

  if (errored) {
    return {
      status: "error",
      itemsCreated,
      itemsUpdated,
      itemsRemoved,
      warnings,
      message: errored.message,
    };
  }
  return { status: "success", itemsCreated, itemsUpdated, itemsRemoved, warnings };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultModelFor(provider: string): string {
  switch (provider) {
    case "claude_api":
      return "claude-haiku-4-5-20251001";
    case "claude_code":
      return "claude-haiku-4-5";
    case "openai":
    case "openai_compat":
      return "gpt-4o-mini";
    case "ollama":
      return "llama3";
    default:
      return "stub";
  }
}

function findPackagedProfilesDir(): string {
  // The @specgen/core package ships its profiles under `<core-pkg-root>/profiles/`.
  // This heuristic assumes CLI is at packages/cli/{src,dist} in the monorepo.
  // TODO: revisit packaging in Phase E — use import.meta.resolve('@specgen/core/profiles') or similar.
  const here = fileURLToPath(new URL("..", import.meta.url));
  return path.resolve(here, "..", "..", "core", "profiles");
}
