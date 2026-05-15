/**
 * safeParseJson — tolerant JSON extraction from LLM responses.
 *
 * LLMs often wrap JSON in prose, code fences, or mixed whitespace.
 * This helper tries three strategies before giving up:
 *   1. Parse the whole text as-is.
 *   2. Look for the LAST ```json (or just ```) fenced block.
 *      Last because models often write prose first then conclude with the JSON.
 *   3. Walk the text and extract the first balanced {...} or [...] block,
 *      respecting strings + escapes so braces inside strings don't confuse us.
 *
 * Returns null if nothing parses.
 */
export function safeParseJson(text: string): unknown {
  // 1. Plain JSON
  const trimmed = text.trim();
  if (trimmed) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through
    }
  }

  // 2. Last ```...``` fenced block
  const fenceMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (let i = fenceMatches.length - 1; i >= 0; i--) {
    const candidate = fenceMatches[i]?.[1]?.trim();
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // try next
    }
  }

  // 3. First balanced {...} or [...] block
  for (const open of ["{", "["] as const) {
    const close = open === "{" ? "}" : "]";
    const block = extractBalanced(text, open, close);
    if (!block) continue;
    try {
      return JSON.parse(block);
    } catch {
      // try next strategy
    }
  }

  return null;
}

function extractBalanced(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let inEscape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inEscape) {
      inEscape = false;
      continue;
    }
    if (c === "\\") {
      inEscape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
