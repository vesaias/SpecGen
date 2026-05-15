import type { AiRouter } from "../ai/AiRouter.js";
import type { ParserFileSystem } from "../parser/FileSystem.js";
import type { ParserRegistry } from "../parser/ParserRegistry.js";
import type { ResolvedProfile } from "../profile/Profile.js";
import type { SpecRepository } from "../spec/SpecRepository.js";

// ---------------------------------------------------------------------------
// Context passed to every generator run
// ---------------------------------------------------------------------------

export interface GeneratorContext {
  /** Absolute path to the project being parsed */
  rootDir: string;
  /**
   * Absolute filesystem path where source files referenced by SpecItem.sourceFiles
   * can be read from disk. For local projects this is the same as rootDir; for
   * github-source projects it may be undefined (no on-disk source root) and the
   * AI source-reader will fall back to an empty body. Optional for backwards
   * compat — when omitted, generators that read source default to `rootDir`.
   */
  sourceRootDir?: string;
  /** Resolved profile with manifest + prompt files */
  profile: ResolvedProfile;
  /** Registry of available parsers (generator calls detectAll + parse) */
  parsers: ParserRegistry;
  /** Where to read/write spec data */
  spec: SpecRepository;
  /** AI router used for enriching items with [TODO] fields */
  ai: AiRouter;
  /** Optional freeform guidelines appended to every AI prompt */
  guidelines?: string;
  /** Optional progress callback — generators should call this instead of console.log */
  log?: (msg: string) => void;
  /** Generator-specific options. release-notes expects { diff: string }. */
  options?: Record<string, unknown>;
  /**
   * Per-project AI overrides — when set, take precedence over the profile's
   * default_model / default_temperature / default_max_tokens / default_concurrency.
   * Populated by the server from project.ai (the dashboard's AI tab).
   */
  aiOverrides?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    concurrency?: number;
  };
  /**
   * Pluggable filesystem for parsers. Optional for backwards compat — generators
   * that don't invoke parsers (readme, release-notes) leave this undefined.
   * full-tree-spec will use it to pass fs into parser calls.
   */
  fs?: ParserFileSystem;
}

// ---------------------------------------------------------------------------
// AI call audit record (one per item enriched)
// ---------------------------------------------------------------------------

export interface GeneratorAiCallSummary {
  itemId: string;
  provider: string;
  model: string;
  durationMs: number;
  costUsd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
  };
  status: "ok" | "schema_invalid" | "json_parse_failed" | "provider_error";
  error?: string;
}

// ---------------------------------------------------------------------------
// Streaming event shape
// ---------------------------------------------------------------------------

export type GeneratorEvent =
  | { type: "progress"; message: string }
  | { type: "item-updated"; itemId: string }
  | { type: "warning"; message: string }
  | { type: "error"; error: Error }
  | {
      type: "done";
      stats: {
        itemsCreated: number;
        itemsUpdated: number;
        itemsRemoved: number;
        warnings: number;
        aiCalls: GeneratorAiCallSummary[];
        aiCostUsdTotal: number;
      };
    };

// ---------------------------------------------------------------------------
// Plugin interface
// ---------------------------------------------------------------------------

export interface GeneratorPlugin {
  /** Unique machine id, e.g. "full-tree-spec" */
  id: string;
  /** Human-readable name */
  name: string;
  /** Short description of what this generator produces */
  description: string;
  /**
   * Profile ids this generator works with.
   * Use '*' to accept any profile.
   */
  supports_profiles: string[] | "*";
  /**
   * Parser ids this generator requires.
   * Use '*' to accept any combination.
   */
  supports_parsers: string[] | "*";
  /** Item types this generator can produce */
  produces_item_types: string[];

  /**
   * Execute the generator.
   * Yields GeneratorEvent values as work progresses.
   * The final event MUST be 'done' or 'error'.
   */
  run(ctx: GeneratorContext): AsyncIterable<GeneratorEvent>;
}
