import { LocalFs } from "@specgen/core";
import type { ParserFileSystem, ParserRegistry } from "@specgen/core";
import { classifyProject } from "./classifyProject.js";
import type { ProjectClassification } from "./classifyProject.js";
import { detectLanguages } from "./detectLanguages.js";
import { pickServerAi } from "./serverAi.js";

export interface ProbeInput {
  source:
    | { type: "local"; localPath: string }
    | { type: "github"; owner: string; repo: string; ref?: string; token: string };
}

export interface ParserMatch {
  parser: string;
  confidence: number;
  atSubdir?: string;
}

export interface ParserRejection {
  parser: string;
  reason: string;
  lookedAt: string[];
}

export interface DetectReport {
  canParse: boolean;
  matches: ParserMatch[];
  rejected: ParserRejection[];
  languagesDetected: Array<{ language: string; fileCount: number; parserAvailable: boolean }>;
  suggestedProfile: string;
  suggestedParsers: string[];
  /**
   * AI-augmented classification. null when no server AI is configured or the
   * AI call failed; undefined when classification was not attempted (e.g.
   * legacy callers that didn't supply an AI factory). Always best-effort and
   * additive — never the basis of `canParse`.
   */
  aiClassification?: ProjectClassification | null;
}

/**
 * Options for `probeProject`. The classifier is injected so that tests can
 * supply a deterministic mock without leaning on `process.env`. Production
 * callers leave `pickAi` unset, in which case `pickServerAi()` (env-driven) is
 * used.
 */
export interface ProbeOpts {
  /**
   * Provide a server-level AI client + model id for the classifier, or null
   * to skip AI augmentation entirely. Defaults to `pickServerAi()`.
   */
  pickAi?: () => { client: import("@specgen/core").AiClient; model: string } | null;
}

/**
 * Run a pure read-only detection pass against the given source and return a
 * `DetectReport`. Nothing is persisted — this is the pre-flight check shown in
 * the project creation wizard before the user confirms.
 *
 * `buildGitHubFs` is injected so callers can supply the real implementation or
 * a test double. It may return a `ParserFileSystem` directly or a Promise of
 * one — both are handled.
 */
export async function probeProject(
  input: ProbeInput,
  parsers: ParserRegistry,
  buildGitHubFs: (cfg: {
    owner: string;
    repo: string;
    ref: string;
    token: string;
  }) => ParserFileSystem | Promise<ParserFileSystem>,
  opts: ProbeOpts = {},
): Promise<DetectReport> {
  // 1. Construct ParserFileSystem for the candidate source
  let fs: ParserFileSystem;
  if (input.source.type === "local") {
    fs = new LocalFs(input.source.localPath);
  } else {
    fs = await buildGitHubFs({
      owner: input.source.owner,
      repo: input.source.repo,
      ref: input.source.ref ?? "main",
      token: input.source.token,
    });
  }

  // 2. Run detection on every registered parser (not just matches) so we can
  //    report rejections too. ParserRegistry.detectAll filters confidence === 0
  //    so we call each plugin directly here.
  const allPlugins = parsers.list();
  const rawResults = await Promise.all(
    allPlugins.map(async (plugin) => {
      const r = await plugin.detect({ rootDir: fs.rootDir, fs });
      return { plugin, confidence: r.confidence, subDirs: r.subDirs ?? [] };
    }),
  );

  const matches: ParserMatch[] = rawResults
    .filter((r) => r.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .map((r) => ({
      parser: r.plugin.id,
      confidence: r.confidence,
      atSubdir: r.subDirs[0],
    }));

  // Reflect the actual subdirs the subdirAwarePlugin would walk — root plus
  // every immediate directory under it. Previously this field was a hardcoded
  // copy lie ("/", "backend/", "frontend/", ...) that didn't match reality on
  // GitHub-sourced or differently-laid-out projects.
  let lookedAt: string[];
  try {
    const entries = await fs.listDir("");
    lookedAt = ["/", ...entries.filter((e) => e.isDirectory).map((e) => `${e.name}/`)];
  } catch {
    lookedAt = ["/"];
  }

  const rejected: ParserRejection[] = rawResults
    .filter((r) => r.confidence === 0)
    .map((r) => ({
      parser: r.plugin.id,
      reason: `${r.plugin.id} found no marker files at root or in immediate subdirectories`,
      lookedAt,
    }));

  // 3. Language census — surface "language X detected, no parser ships" hints
  const languagesDetected = await detectLanguages(fs);

  // 4. AI augmentation. Best-effort: skip silently if no AI provider is
  //    configured at the server level. Never fails the probe.
  let aiClassification: ProjectClassification | null = null;
  const pickAi = opts.pickAi ?? pickServerAi;
  const aiClient = pickAi();
  if (aiClient) {
    try {
      aiClassification = await classifyProject(fs, {
        ai: aiClient.client,
        model: aiClient.model,
        github:
          input.source.type === "github"
            ? {
                owner: input.source.owner,
                repo: input.source.repo,
                token: input.source.token,
              }
            : undefined,
      });
    } catch (err) {
      // Log + proceed without AI classification. Console is acceptable here:
      // this is a probe-time best-effort path, not a hot loop.
      console.warn("classifyProject failed:", (err as Error).message);
      aiClassification = null;
    }
  }

  return {
    canParse: matches.length > 0,
    matches,
    rejected,
    languagesDetected,
    suggestedProfile: "pm-spec",
    suggestedParsers: matches.map((m) => m.parser),
    aiClassification,
  };
}
