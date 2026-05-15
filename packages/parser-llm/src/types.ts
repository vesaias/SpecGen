/**
 * Public option types for @specgen/parser-llm.
 *
 * The parser itself is a `ParserPlugin` (see index.ts). Callers pass these
 * options via `ParseInput.config` — keyed by `llm` namespace conventionally,
 * but the parser reads them off the root of `config` directly for simplicity.
 *
 * Two modes are supported:
 *
 *   - "fallback" (default): only extract from files NOT already covered by
 *     the rule parsers. The accumulated rule-parser output is read from
 *     `ParseInput.ruleParserOutput`; any file appearing in any rule item's
 *     `sourceFiles` is skipped.
 *
 *   - "standalone": extract from every relevant source file in the repo
 *     (no rule-parser deduplication). Used when the project is configured
 *     for `parserMode: "llm-only"`.
 */
export type LlmParserMode = "fallback" | "standalone";

export interface LlmParserOpts {
  /** Default "fallback". See module comment. */
  mode?: LlmParserMode;
  /** Per-file byte cap fed to the AI. Default 32_000. */
  perFileBytes?: number;
  /**
   * Total bytes across all AI calls. Default 256_000 (~$0.05 with Haiku-class
   * pricing). Once the budget is exhausted, the parser stops queuing new
   * AI calls and emits a warning.
   */
  totalBytes?: number;
  /** Concurrency for AI calls. Default 3. */
  concurrency?: number;
}
