import { describe, expect, it } from "vitest";
import { LocalClient } from "../../src/ai/providers/LocalClient.js";

describe("LocalClient", () => {
  it("returns deterministic stub output", async () => {
    const c = new LocalClient();
    const r = await c.complete({
      prompt: "Describe X.",
      model: "stub",
      temperature: 0,
      maxTokens: 100,
    });
    expect(r.text).toContain("[stub output");
    expect(r.usage.input_tokens).toBeGreaterThan(0);
    expect(r.usage.output_tokens).toBeGreaterThan(0);
    expect(r.usage.cache_read_tokens).toBe(0);
    expect(r.usage.cache_write_tokens).toBe(0);
  });

  it("honours mode='empty'", async () => {
    const r = await new LocalClient({ mode: "empty" }).complete({
      prompt: "x",
      model: "stub",
      temperature: 0,
      maxTokens: 100,
    });
    expect(r.text).toBe("");
    expect(r.usage.output_tokens).toBe(0);
  });

  it("honours mode='error'", async () => {
    const c = new LocalClient({ mode: "error" });
    await expect(
      c.complete({
        prompt: "x",
        model: "stub",
        temperature: 0,
        maxTokens: 100,
      }),
    ).rejects.toThrow(/simulated/i);
  });

  it("provider id is 'local' and reports available models", () => {
    const c = new LocalClient();
    expect(c.provider).toBe("local");
    expect(c.models.find((m) => m.id === "stub")).toBeDefined();
  });
});
