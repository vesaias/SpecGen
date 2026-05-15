// Placeholder type — branded type for project slugs. Will be expanded in later tasks.
export type ProjectSlug = string & { __brand: "ProjectSlug" };

/**
 * Per-project switch driving which parsers participate in the parse pipeline.
 *
 *   - "rule-only" (default) — only the registered rule parsers run; the LLM
 *     parser is skipped even if it advertises confidence > 0.
 *   - "rule-plus-llm-fallback" — rule parsers run first; the LLM parser then
 *     runs in `mode: "fallback"` and only fills gaps (files not already
 *     covered by any rule item's `sourceFiles`).
 *   - "llm-only" — rule parsers are skipped; the LLM parser runs in
 *     `mode: "standalone"` against every relevant source file.
 *
 * Read by `full-tree-spec`'s parser dispatch block. Stored on
 * `Project.parserConfig.parserMode`.
 */
export type ParserMode = "rule-only" | "rule-plus-llm-fallback" | "llm-only";
