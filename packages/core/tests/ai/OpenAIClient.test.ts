import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation((opts: { apiKey: string; baseURL?: string }) => ({
      __ctorArgs: opts,
      chat: { completions: { create: mockCreate } },
    })),
  };
});

import OpenAI from "openai";
import { OpenAIClient } from "../../src/ai/providers/OpenAIClient.js";

beforeEach(() => {
  mockCreate.mockReset();
  vi.mocked(OpenAI).mockClear();
});

describe("OpenAIClient", () => {
  it("calls chat.completions.create with model + max_tokens + messages", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "hello" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const client = new OpenAIClient({ apiKey: "test-key" });
    const r = await client.complete({
      prompt: "Describe X",
      model: "gpt-4o",
      temperature: 0.2,
      maxTokens: 1000,
    });

    expect(r.text).toBe("hello");
    expect(r.usage).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    });

    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.model).toBe("gpt-4o");
    expect(callArg.max_tokens).toBe(1000);
    expect(callArg.temperature).toBe(0.2);
    expect(callArg.messages).toEqual([{ role: "user", content: "Describe X" }]);
  });

  it("forwards system prompt as a separate message when provided", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    await new OpenAIClient({ apiKey: "k" }).complete({
      prompt: "user prompt",
      system: "You are a helpful assistant.",
      model: "gpt-4o",
      temperature: 0,
      maxTokens: 100,
    });

    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.messages).toEqual([
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "user prompt" },
    ]);
  });

  it("concatenates cachedPrefix into prompt (no native caching support)", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    await new OpenAIClient({ apiKey: "k" }).complete({
      prompt: "user prompt",
      cachedPrefix: "Prior context.",
      model: "gpt-4o",
      temperature: 0,
      maxTokens: 100,
    });

    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.messages[0].content).toBe("Prior context.\n\nuser prompt");
  });

  it("forwards baseUrl into SDK constructor for openai_compat", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });

    new OpenAIClient({
      apiKey: "k",
      baseUrl: "https://api.together.ai/v1",
      providerId: "openai_compat",
    });
    expect(vi.mocked(OpenAI)).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "k", baseURL: "https://api.together.ai/v1" }),
    );
  });

  it("provider id is 'openai' by default and 'openai_compat' when specified", () => {
    expect(new OpenAIClient({ apiKey: "k" }).provider).toBe("openai");
    expect(new OpenAIClient({ apiKey: "k", providerId: "openai_compat" }).provider).toBe(
      "openai_compat",
    );
  });

  it("propagates errors with provider context", async () => {
    mockCreate.mockRejectedValue(new Error("rate limited"));

    const client = new OpenAIClient({ apiKey: "k" });
    await expect(
      client.complete({ prompt: "x", model: "gpt-4o", temperature: 0, maxTokens: 100 }),
    ).rejects.toThrow(/openai.*rate limited/i);
  });

  it("openai_compat error prefix matches provider id", async () => {
    mockCreate.mockRejectedValue(new Error("server unreachable"));
    const client = new OpenAIClient({ apiKey: "k", providerId: "openai_compat" });
    await expect(
      client.complete({ prompt: "x", model: "x", temperature: 0, maxTokens: 100 }),
    ).rejects.toThrow(/openai_compat.*server unreachable/i);
  });

  it("missing usage on response defaults all token counts to 0", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "ok" } }],
      // no usage field
    });

    const client = new OpenAIClient({ apiKey: "k" });
    const r = await client.complete({
      prompt: "x",
      model: "gpt-4o",
      temperature: 0,
      maxTokens: 100,
    });
    expect(r.usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    });
  });

  it("missing message content returns empty string", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: null } }],
      usage: { prompt_tokens: 1, completion_tokens: 0 },
    });

    const client = new OpenAIClient({ apiKey: "k" });
    const r = await client.complete({
      prompt: "x",
      model: "gpt-4o",
      temperature: 0,
      maxTokens: 10,
    });
    expect(r.text).toBe("");
  });

  it("trims whitespace from text", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "  hello world  \n" } }],
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    });

    const client = new OpenAIClient({ apiKey: "k" });
    const r = await client.complete({
      prompt: "x",
      model: "gpt-4o",
      temperature: 0,
      maxTokens: 10,
    });
    expect(r.text).toBe("hello world");
  });

  it("models list includes gpt-4o + gpt-4o-mini + gpt-5", () => {
    const c = new OpenAIClient({ apiKey: "k" });
    const ids = c.models.map((m) => m.id);
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("gpt-4o-mini");
    expect(ids).toContain("gpt-5");
  });
});
