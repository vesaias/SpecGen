import { describe, expect, it, vi } from "vitest";
import type { AiClient, AiCompletionInput, AiCompletionResult } from "../../src/ai/AiClient.js";
import { AiRouter } from "../../src/ai/AiRouter.js";

function fakeClient(provider: string, complete: AiClient["complete"]): AiClient {
  return { provider, models: [{ id: "stub", displayName: "stub" }], complete };
}

const stubResult = (text: string): AiCompletionResult => ({
  text,
  usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0 },
});

describe("AiRouter", () => {
  it("returns primary's result when first try succeeds", async () => {
    const primary = fakeClient("p1", vi.fn().mockResolvedValue(stubResult("ok")));
    const fallback = fakeClient("p2", vi.fn());

    const r = await new AiRouter({ primary, fallback }).complete({
      prompt: "x",
      model: "m",
      temperature: 0,
      maxTokens: 100,
    });

    expect(r.text).toBe("ok");
    expect(primary.complete).toHaveBeenCalledTimes(1);
    expect(fallback.complete).not.toHaveBeenCalled();
  });

  it("retries primary on failure with exponential backoff", async () => {
    const primary = fakeClient(
      "p1",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"))
        .mockResolvedValue(stubResult("recovered")),
    );
    const sleepMs = vi.fn().mockResolvedValue(undefined);

    const r = await new AiRouter({ primary, sleepMs }).complete({
      prompt: "x",
      model: "m",
      temperature: 0,
      maxTokens: 100,
    });

    expect(r.text).toBe("recovered");
    expect(primary.complete).toHaveBeenCalledTimes(3);
    // Backoff: 2s after attempt 1, 4s after attempt 2 (no sleep after the success)
    expect(sleepMs).toHaveBeenCalledTimes(2);
    expect(sleepMs).toHaveBeenNthCalledWith(1, 2000);
    expect(sleepMs).toHaveBeenNthCalledWith(2, 4000);
  });

  it("does not sleep after the final attempt", async () => {
    const primary = fakeClient(
      "p1",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("e1"))
        .mockRejectedValueOnce(new Error("e2"))
        .mockRejectedValueOnce(new Error("e3"))
        .mockResolvedValue(stubResult("late")),
    );
    const sleepMs = vi.fn().mockResolvedValue(undefined);

    await new AiRouter({ primary, sleepMs }).complete({
      prompt: "x",
      model: "m",
      temperature: 0,
      maxTokens: 100,
    });

    // 4 attempts, success on 4th — sleeps happen between attempts so 3 sleeps
    expect(primary.complete).toHaveBeenCalledTimes(4);
    expect(sleepMs).toHaveBeenCalledTimes(3);
    expect(sleepMs).toHaveBeenNthCalledWith(3, 8000);
  });

  it("throws primary's last error when no fallback configured", async () => {
    const primary = fakeClient("p1", vi.fn().mockRejectedValue(new Error("primary blew up")));
    const sleepMs = vi.fn().mockResolvedValue(undefined);

    const router = new AiRouter({ primary, sleepMs });
    await expect(
      router.complete({ prompt: "x", model: "m", temperature: 0, maxTokens: 100 }),
    ).rejects.toThrow(/primary blew up/);
    // 4 attempts; 3 sleeps
    expect(primary.complete).toHaveBeenCalledTimes(4);
    expect(sleepMs).toHaveBeenCalledTimes(3);
  });

  it("falls back to secondary when primary exhausts retries", async () => {
    const primary = fakeClient("p1", vi.fn().mockRejectedValue(new Error("primary down")));
    const fallback = fakeClient("p2", vi.fn().mockResolvedValue(stubResult("from fallback")));
    const sleepMs = vi.fn().mockResolvedValue(undefined);

    const r = await new AiRouter({ primary, fallback, sleepMs }).complete({
      prompt: "x",
      model: "m",
      temperature: 0,
      maxTokens: 100,
    });

    expect(r.text).toBe("from fallback");
    expect(primary.complete).toHaveBeenCalledTimes(4);
    expect(fallback.complete).toHaveBeenCalledTimes(1);
  });

  it("retries fallback too with same backoff", async () => {
    const primary = fakeClient("p1", vi.fn().mockRejectedValue(new Error("p down")));
    const fallback = fakeClient(
      "p2",
      vi.fn().mockRejectedValueOnce(new Error("fb1")).mockResolvedValue(stubResult("fb ok")),
    );
    const sleepMs = vi.fn().mockResolvedValue(undefined);

    const r = await new AiRouter({ primary, fallback, sleepMs }).complete({
      prompt: "x",
      model: "m",
      temperature: 0,
      maxTokens: 100,
    });

    expect(r.text).toBe("fb ok");
    expect(primary.complete).toHaveBeenCalledTimes(4);
    expect(fallback.complete).toHaveBeenCalledTimes(2);
    // Primary: 3 sleeps, Fallback: 1 sleep between attempts 1 and 2 = 4 total
    expect(sleepMs).toHaveBeenCalledTimes(4);
  });

  it("throws combined error when both providers fail all attempts", async () => {
    const primary = fakeClient("primary-id", vi.fn().mockRejectedValue(new Error("p err")));
    const fallback = fakeClient("fallback-id", vi.fn().mockRejectedValue(new Error("f err")));
    const sleepMs = vi.fn().mockResolvedValue(undefined);

    const router = new AiRouter({ primary, fallback, sleepMs });
    await expect(
      router.complete({ prompt: "x", model: "m", temperature: 0, maxTokens: 100 }),
    ).rejects.toThrow(
      /Both providers failed.*Primary \(primary-id\): p err.*Fallback \(fallback-id\): f err/s,
    );
  });

  it("primaryProvider getter returns the primary client's provider id", () => {
    const primary = fakeClient("claude_code", vi.fn());
    const router = new AiRouter({ primary });
    expect(router.primaryProvider).toBe("claude_code");
  });
});
