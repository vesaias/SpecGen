/**
 * @specgen/parser-llm — universal AI-driven parser.
 *
 * Extracts BackendSpec[] / FrontendSpec[] / EventSpec[] from arbitrary source
 * code by asking an LLM. Designed to be used either standalone (any language)
 * or as a gap-fill behind the rule parsers (`mode: "fallback"`).
 *
 * The parser requires `ParseInput.aiClient` to be set — without an AI client
 * it emits a warning and returns an empty result. Rule parsers ignore the
 * field; only LLM-driven parsers read it.
 *
 * Per-project opt-in is controlled by `project.parserConfig.parserMode`:
 *   - "rule-only"               (default — LLM parser not invoked)
 *   - "rule-plus-llm-fallback"  (rule parsers run first, LLM fills gaps)
 *   - "llm-only"                (rule parsers skipped, LLM is the only source)
 */
import type {
  DetectInput,
  DetectResult,
  ParseInput,
  ParseResult,
  ParserPlugin,
} from "@specgen/core";
import { detectLlm } from "./detect.js";
import { parseRepo } from "./parseRepo.js";

export const llmParser: ParserPlugin = {
  id: "llm",
  name: "Universal AI Parser",

  async detect(input: DetectInput): Promise<DetectResult> {
    return detectLlm(input);
  },

  async parse(input: ParseInput): Promise<ParseResult> {
    return parseRepo(input);
  },
};

export default llmParser;
export { detectLlm } from "./detect.js";
export { parseRepo } from "./parseRepo.js";
export { classifyFile, isSourceFile, IGNORE_DIRS } from "./heuristics.js";
export type { FileKind } from "./heuristics.js";
export type { LlmParserMode, LlmParserOpts } from "./types.js";
