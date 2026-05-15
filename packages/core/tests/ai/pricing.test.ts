import { describe, expect, it } from "vitest";
import { FREE_PROVIDERS, PRICING, calcCost, getPricing } from "../../src/ai/pricing.js";

describe("pricing", () => {
  it("returns 0 for FREE_PROVIDERS regardless of token count", () => {
    expect(calcCost("claude_code", "claude-sonnet-4-6", 1_000_000, 500_000)).toBe(0);
    expect(calcCost("ollama", "llama3", 1_000_000, 500_000)).toBe(0);
  });

  it("computes claude_api cost from input + output tokens", () => {
    // claude-sonnet-4-6: $3/MTok in, $15/MTok out
    const cost = calcCost("claude_api", "claude-sonnet-4-6", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(3 + 15, 5);
  });

  it("computes claude_api cache_read at 10% of input rate", () => {
    // 1M input + 1M cache_read = $3 + $0.30 = $3.30
    const cost = calcCost("claude_api", "claude-sonnet-4-6", 1_000_000, 0, 1_000_000, 0);
    expect(cost).toBeCloseTo(3 + 0.3, 5);
  });

  it("computes claude_api cache_write at 125% of input rate", () => {
    // 1M cache_write only = $3.75
    const cost = calcCost("claude_api", "claude-sonnet-4-6", 0, 0, 0, 1_000_000);
    expect(cost).toBeCloseTo(3.75, 5);
  });

  it("computes openai cost from input + output tokens", () => {
    // gpt-4o: $2.50/MTok in, $10/MTok out
    const cost = calcCost("openai", "gpt-4o", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(2.5 + 10, 5);
  });

  it("returns 0 for unknown (provider, model)", () => {
    expect(calcCost("openai", "no-such-model", 1000, 1000)).toBe(0);
    expect(calcCost("claude_api", "no-such-model", 1000, 1000)).toBe(0);
    expect(calcCost("unknown_provider", "anything", 1000, 1000)).toBe(0);
  });

  it("getPricing returns the rate card for a known combo", () => {
    const p = getPricing("openai", "gpt-4o");
    expect(p).toBeDefined();
    expect(p?.input_per_mtok).toBe(2.5);
    expect(p?.output_per_mtok).toBe(10);
  });

  it("getPricing returns undefined for unknown combo", () => {
    expect(getPricing("openai", "no-such-model")).toBeUndefined();
    expect(getPricing("unknown", "x")).toBeUndefined();
  });

  it("FREE_PROVIDERS is exactly { claude_code, ollama }", () => {
    expect(FREE_PROVIDERS).toEqual(new Set(["claude_code", "ollama"]));
  });

  it("PRICING table includes the documented Anthropic + OpenAI models", () => {
    expect(PRICING.claude_api?.["claude-sonnet-4-6"]).toBeDefined();
    expect(PRICING.claude_api?.["claude-opus-4-7"]).toBeDefined();
    expect(PRICING.claude_api?.["claude-haiku-4-5-20251001"]).toBeDefined();
    expect(PRICING.openai?.["gpt-4o"]).toBeDefined();
    expect(PRICING.openai?.["gpt-4o-mini"]).toBeDefined();
  });

  it("openai_compat shares the openai rate card by default", () => {
    expect(PRICING.openai_compat?.["gpt-4o"]).toEqual(PRICING.openai?.["gpt-4o"]);
  });

  it("calcCost handles zero tokens (returns 0)", () => {
    expect(calcCost("claude_api", "claude-sonnet-4-6", 0, 0, 0, 0)).toBe(0);
  });
});
