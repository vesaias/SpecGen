import { describe, expect, it } from "vitest";
import { emptyRunSummary, mergeAiCallIntoSummary } from "../../src/run/RunSummary.js";

describe("RunSummary", () => {
  it("emptyRunSummary has zero counts and empty arrays", () => {
    const s = emptyRunSummary();
    expect(s.itemsCreated).toBe(0);
    expect(s.itemsUpdated).toBe(0);
    expect(s.itemsRemoved).toBe(0);
    expect(s.warnings).toBe(0);
    expect(s.aiCalls).toEqual([]);
    expect(s.aiCostUsdTotal).toBe(0);
  });

  it("mergeAiCallIntoSummary appends + sums cost", () => {
    const s = emptyRunSummary();
    const updated = mergeAiCallIntoSummary(s, {
      itemId: "x",
      provider: "claude_api",
      model: "claude-sonnet-4-6",
      durationMs: 1200,
      costUsd: 0.015,
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      },
      status: "ok",
    });
    expect(updated.aiCalls).toHaveLength(1);
    expect(updated.aiCostUsdTotal).toBeCloseTo(0.015, 5);
  });

  it("mergeAiCallIntoSummary does not mutate the input", () => {
    const s = emptyRunSummary();
    mergeAiCallIntoSummary(s, {
      itemId: "x",
      provider: "local",
      model: "stub",
      durationMs: 1,
      costUsd: 0,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
      status: "ok",
    });
    expect(s.aiCalls).toHaveLength(0);
    expect(s.aiCostUsdTotal).toBe(0);
  });
});
