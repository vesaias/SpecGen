import { ClaudeApiClient, ClaudeCodeClient, OpenAIClient } from "@specgen/core";
import type { AiClient } from "@specgen/core";

/**
 * Pick a sensible server-level AI client for cheap, non-project-scoped calls
 * (currently used only by the probe-time classifier).
 *
 * Returns null when no provider is configured. Callers must treat this as
 * best-effort — never fail the calling flow if AI is unavailable.
 *
 * Preference order:
 *   1. `claude_code` when a Claude Pro/Max OAuth token is present (free).
 *   2. `claude_api` via ANTHROPIC_API_KEY (Haiku 4.5 — cheap).
 *   3. `openai` via OPENAI_API_KEY (gpt-4o-mini — cheap).
 */
export function pickServerAi(): { client: AiClient; model: string } | null {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    return { client: new ClaudeCodeClient(), model: "claude-haiku-4-5" };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      client: new ClaudeApiClient({ apiKey: process.env.ANTHROPIC_API_KEY }),
      model: "claude-haiku-4-5-20251001",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      client: new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY, providerId: "openai" }),
      model: "gpt-4o-mini",
    };
  }
  return null;
}
