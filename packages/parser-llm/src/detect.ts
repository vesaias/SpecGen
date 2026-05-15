import type { DetectInput, DetectResult } from "@specgen/core";
import { IGNORE_DIRS, isSourceFile } from "./heuristics.js";

/**
 * Returns confidence 0.5 if the source has at least one source file in the
 * broad extension list. The orchestrator decides whether to actually run the
 * LLM parser — gating is a per-project setting, not a parser-side concern.
 */
export async function detectLlm(input: DetectInput): Promise<DetectResult> {
  const { fs } = input;
  try {
    for await (const entry of fs.walk("", { ignore: IGNORE_DIRS })) {
      if (entry.isDirectory) continue;
      if (isSourceFile(entry.path)) {
        return { confidence: 0.5, subDirs: [] };
      }
    }
  } catch {
    // Filesystem error — leave at 0
  }
  return { confidence: 0, subDirs: [] };
}
