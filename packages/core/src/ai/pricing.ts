/**
 * LLM pricing and cost calculation.
 *
 * Prices in USD per million tokens as of 2026-05. Update PRICING when models change.
 * Sources: https://www.anthropic.com/pricing, https://openai.com/pricing
 *
 * Mirrors V:/JTrakProject/backend/analyzer/llm_cost.py.
 *
 * Keyed by (provider, model) because the same model can be billed differently via
 * different providers — claude-sonnet-4-6 costs $3/MTok via the Anthropic API but
 * is covered by the Pro/Max subscription when used via the Claude Code CLI.
 */

export interface ModelPricing {
  input_per_mtok: number;
  output_per_mtok: number;
  cache_read_per_mtok: number;
  cache_write_per_mtok: number;
}

export const PRICING: Record<string, Record<string, ModelPricing>> = {
  claude_api: {
    "claude-sonnet-4-6": {
      input_per_mtok: 3.0,
      output_per_mtok: 15.0,
      cache_read_per_mtok: 0.3,
      cache_write_per_mtok: 3.75,
    },
    "claude-opus-4-7": {
      input_per_mtok: 15.0,
      output_per_mtok: 75.0,
      cache_read_per_mtok: 1.5,
      cache_write_per_mtok: 18.75,
    },
    "claude-haiku-4-5-20251001": {
      input_per_mtok: 1.0,
      output_per_mtok: 5.0,
      cache_read_per_mtok: 0.1,
      cache_write_per_mtok: 1.25,
    },
  },
  openai: {
    "gpt-4o": {
      input_per_mtok: 2.5,
      output_per_mtok: 10.0,
      cache_read_per_mtok: 2.5,
      cache_write_per_mtok: 2.5,
    },
    "gpt-4o-mini": {
      input_per_mtok: 0.15,
      output_per_mtok: 0.6,
      cache_read_per_mtok: 0.15,
      cache_write_per_mtok: 0.15,
    },
  },
  openai_compat: {
    // Same defaults as openai; user-deployed compat endpoints may differ.
    "gpt-4o": {
      input_per_mtok: 2.5,
      output_per_mtok: 10.0,
      cache_read_per_mtok: 2.5,
      cache_write_per_mtok: 2.5,
    },
    "gpt-4o-mini": {
      input_per_mtok: 0.15,
      output_per_mtok: 0.6,
      cache_read_per_mtok: 0.15,
      cache_write_per_mtok: 0.15,
    },
  },
};

/** Providers covered by flat subscription / local compute — always $0. */
export const FREE_PROVIDERS: Set<string> = new Set(["claude_code", "ollama"]);

export function getPricing(provider: string, model: string): ModelPricing | undefined {
  return PRICING[provider]?.[model];
}

/**
 * Calculate USD cost for a single LLM call.
 *
 * Returns 0 for FREE_PROVIDERS (claude_code subscription, local ollama) or when
 * the (provider, model) combo isn't in the pricing table.
 */
export function calcCost(
  provider: string,
  model: string,
  input_tokens = 0,
  output_tokens = 0,
  cache_read_tokens = 0,
  cache_write_tokens = 0,
): number {
  if (FREE_PROVIDERS.has(provider)) return 0;
  const p = getPricing(provider, model);
  if (!p) return 0;
  return (
    (input_tokens * p.input_per_mtok) / 1_000_000 +
    (output_tokens * p.output_per_mtok) / 1_000_000 +
    (cache_read_tokens * p.cache_read_per_mtok) / 1_000_000 +
    (cache_write_tokens * p.cache_write_per_mtok) / 1_000_000
  );
}
