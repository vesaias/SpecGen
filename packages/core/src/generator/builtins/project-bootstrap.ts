/**
 * project-bootstrap — Built-in generator that runs once per project to produce
 * a high-level summary of what the project does.
 *
 * Pipeline:
 * 1. Read key files from the source repo (README, package.json, *.csproj, etc.)
 *    — each file capped at 4 KB, total ~10 files
 * 2. Run detectAll to find which parsers recognise the project
 * 3. Render the project-bootstrap prompt + call AI (single call, 1500 max tokens)
 * 4. Parse the JSON response (tolerant: safeParseJson 3-strategy)
 * 5. Write { ...spec.meta, bootstrap } back to spec.json
 *    — if no spec exists yet, create a minimal one
 * 6. Yield progress / item-updated / done events
 *
 * Bootstrap is best-effort decoration: if the AI returns unparseable JSON,
 * a stub object is written and a warning is emitted (the run does NOT fail).
 */

import path from "node:path";
import { renderPrompt } from "../../ai/PromptRenderer.js";
import { calcCost } from "../../ai/pricing.js";
import { safeParseJson } from "../../ai/safeParseJson.js";
import type { ParserFileSystem } from "../../parser/FileSystem.js";
import { emptyRunSummary } from "../../run/RunSummary.js";
import type { GeneratorAiCallSummary, GeneratorContext, GeneratorPlugin } from "../Generator.js";

// ---------------------------------------------------------------------------
// Key files to gather from the source repo
// ---------------------------------------------------------------------------

const KEY_FILES = [
  "README.md",
  "README",
  "readme.md",
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "Cargo.toml",
  "go.mod",
  "*.csproj",
  "*.sln",
  "docker-compose.yml",
  "Dockerfile",
];

const MAX_FILE_BYTES = 4096;
const MAX_GLOB_MATCHES = 20;
const WALK_IGNORE = [
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  ".vite",
  "venv",
  "__pycache__",
  "target",
  "bin",
  "obj",
];

/**
 * Match a glob pattern with only `*` wildcards (not recursive).
 * Used for patterns like `*.csproj` — matches files at any level whose
 * final path segment matches.
 */
function matchGlob(filePath: string, pat: string): boolean {
  // Strip directory component — patterns like *.csproj only match the basename
  const basename = filePath.includes("/")
    ? filePath.slice(filePath.lastIndexOf("/") + 1)
    : filePath;
  const re = new RegExp(`^${pat.replace(/\./g, "\\.").replace(/\*/g, "[^/]*")}$`);
  return re.test(basename);
}

/**
 * Gather the highest-signal files from the repo root.
 * - Exact names are tried directly.
 * - Glob patterns (`*.csproj`) walk the tree (capped at MAX_GLOB_MATCHES per pattern).
 * - Each file is capped at MAX_FILE_BYTES to keep the prompt bounded.
 */
async function gatherKeyFiles(fs: ParserFileSystem): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  const tryRead = async (p: string): Promise<void> => {
    if (p in out) return; // already have it
    try {
      if (await fs.exists(p)) {
        const content = await fs.readFile(p);
        out[p] =
          content.length > MAX_FILE_BYTES
            ? `${content.slice(0, MAX_FILE_BYTES)}\n…(truncated)`
            : content;
      }
    } catch {
      // skip unreadable files
    }
  };

  for (const name of KEY_FILES) {
    if (name.includes("*")) {
      // Glob: walk tree and match against the pattern
      let matches = 0;
      for await (const entry of fs.walk("", { ignore: WALK_IGNORE })) {
        if (entry.isDirectory) continue;
        if (matchGlob(entry.path, name)) {
          await tryRead(entry.path);
          matches++;
          if (matches >= MAX_GLOB_MATCHES) break;
        }
      }
    } else {
      await tryRead(name);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export const projectBootstrapGenerator: GeneratorPlugin = {
  id: "project-bootstrap",
  name: "Project bootstrap",
  description: "One-shot AI summary of a project's purpose, tech stack, and suggested profile.",
  supports_profiles: "*",
  supports_parsers: "*",
  produces_item_types: [],

  async *run(ctx: GeneratorContext) {
    // ctx.fs is required — bootstrap reads source files
    if (!ctx.fs) {
      yield {
        type: "error" as const,
        error: new Error("project-bootstrap requires ctx.fs (source filesystem)"),
      };
      yield { type: "done" as const, stats: emptyRunSummary() };
      return;
    }

    yield { type: "progress" as const, message: "Gathering key files…" };
    const files = await gatherKeyFiles(ctx.fs);
    yield {
      type: "progress" as const,
      message: `Read ${Object.keys(files).length} key file(s): ${Object.keys(files).join(", ") || "(none)"}`,
    };

    // Detect which parsers recognise this project
    const detected = await ctx.parsers.detectAll(ctx.fs.rootDir, ctx.fs);
    const parsers = detected.filter((d) => d.confidence > 0).map((d) => d.plugin.id);

    const repoName = path.basename(ctx.fs.rootDir) || "unknown";

    yield { type: "progress" as const, message: "Rendering bootstrap prompt…" };
    const { system, user } = await renderPrompt({
      profile: ctx.profile,
      itemType: "project-bootstrap",
      guidelines: ctx.guidelines ?? "",
      variables: { repoName, files, parsers },
    });

    yield { type: "progress" as const, message: "Calling AI…" };
    const t0 = Date.now();
    const provider = ctx.ai.primaryProvider;
    const model = ctx.aiOverrides?.model ?? ctx.profile.manifest.ai.default_model;
    const temperature = ctx.aiOverrides?.temperature ?? ctx.profile.manifest.ai.default_temperature;

    let aiCallSummary: GeneratorAiCallSummary;
    let bootstrap: unknown;
    let warningCount = 0;

    try {
      const result = await ctx.ai.complete({
        prompt: user,
        system,
        model,
        temperature,
        maxTokens: ctx.aiOverrides?.maxTokens ?? 1500,
        signal: ctx.signal,
      });
      const durationMs = Date.now() - t0;
      const u = result.usage;
      const cost = calcCost(
        provider,
        model,
        u.input_tokens,
        u.output_tokens,
        u.cache_read_tokens,
        u.cache_write_tokens,
      );

      aiCallSummary = {
        itemId: "__meta__",
        provider,
        model,
        durationMs,
        costUsd: cost,
        usage: u,
        status: "ok",
      };

      const parsed = safeParseJson(result.text);
      if (parsed === null) {
        const msg = "Bootstrap AI returned unparseable JSON — writing stub bootstrap";
        yield { type: "warning" as const, message: msg };
        warningCount++;
        bootstrap = {
          description: "Bootstrap AI output could not be parsed",
          techStack: [],
          areas: [],
        };
        aiCallSummary = {
          ...aiCallSummary,
          status: "json_parse_failed",
          error: "AI response was not valid JSON",
        };
      } else {
        bootstrap = parsed;
      }
    } catch (err) {
      yield { type: "error" as const, error: err as Error };
      yield { type: "done" as const, stats: emptyRunSummary() };
      return;
    }

    // Write bootstrap into spec.meta — create a minimal spec if none exists yet
    const existingSpec = await ctx.spec.read();
    const newSpec = existingSpec ?? {
      meta: {
        target: path.basename(ctx.fs.rootDir),
        version: "v0",
        generatedAt: new Date().toISOString(),
      },
      tree: [],
      items: {},
    };
    newSpec.meta = { ...newSpec.meta, bootstrap };
    await ctx.spec.write(newSpec);

    yield { type: "item-updated" as const, itemId: "__meta__" };

    yield {
      type: "done" as const,
      stats: {
        itemsCreated: 0,
        itemsUpdated: 1,
        itemsRemoved: 0,
        warnings: warningCount,
        aiCalls: [aiCallSummary],
        aiCostUsdTotal: aiCallSummary.costUsd,
      },
    };
  },
};
