import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the SDK before importing the client
vi.mock("@anthropic-ai/sdk", () => {
  const mockCreate = vi.fn();
  const MockAnthropic = vi.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
  (MockAnthropic as unknown as { _mockCreate: typeof mockCreate })._mockCreate = mockCreate;
  return { default: MockAnthropic };
});

import Anthropic from "@anthropic-ai/sdk";
import { ClaudeApiClient } from "../../src/ai/providers/ClaudeApiClient.js";

function getMockCreate() {
  // Each new Anthropic() instance has its own messages.create mock;
  // we grab it from the most recently constructed instance.
  const instances = (
    Anthropic as unknown as {
      mock: { results: Array<{ value: { messages: { create: ReturnType<typeof vi.fn> } } }> };
    }
  ).mock.results;
  return instances[instances.length - 1].value.messages.create as ReturnType<typeof vi.fn>;
}

describe("ClaudeApiClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls messages.create with prompt + model + temperature + max_tokens", async () => {
    const client = new ClaudeApiClient({ apiKey: "test-key" });
    const create = getMockCreate();
    create.mockResolvedValue({
      content: [{ type: "text", text: "hello" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const r = await client.complete({
      prompt: "Describe X",
      model: "claude-sonnet-4-6",
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
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        temperature: 0.2,
        messages: [{ role: "user", content: "Describe X" }],
      }),
    );
  });

  it("sends cachedPrefix as a separate cache_control: ephemeral block", async () => {
    const client = new ClaudeApiClient({ apiKey: "test-key" });
    const create = getMockCreate();
    create.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: {
        input_tokens: 100,
        output_tokens: 5,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 20,
      },
    });

    const r = await client.complete({
      prompt: "Describe X",
      model: "claude-sonnet-4-6",
      temperature: 0,
      maxTokens: 100,
      cachedPrefix: "Prior context here.",
    });

    // Usage extracted including cache fields
    expect(r.usage.cache_read_tokens).toBe(80);
    expect(r.usage.cache_write_tokens).toBe(20);

    // Verify the messages payload has 2 content blocks, the first with cache_control: ephemeral
    const callArg = create.mock.calls[0][0];
    expect(callArg.messages).toHaveLength(1);
    const content = callArg.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content).toHaveLength(2);
    expect(content[0]).toEqual({
      type: "text",
      text: "Prior context here.",
      cache_control: { type: "ephemeral" },
    });
    expect(content[1]).toEqual({ type: "text", text: "Describe X" });
  });

  it("forwards system prompt when provided", async () => {
    const client = new ClaudeApiClient({ apiKey: "test-key" });
    const create = getMockCreate();
    create.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await client.complete({
      prompt: "x",
      model: "m",
      temperature: 0,
      maxTokens: 10,
      system: "You are a helpful assistant.",
    });

    expect(create.mock.calls[0][0].system).toBe("You are a helpful assistant.");
  });

  it("propagates API errors with provider context", async () => {
    const client = new ClaudeApiClient({ apiKey: "test-key" });
    const create = getMockCreate();
    create.mockRejectedValue(new Error("rate limited"));

    await expect(
      client.complete({ prompt: "x", model: "claude-sonnet-4-6", temperature: 0, maxTokens: 100 }),
    ).rejects.toThrow(/claude_api.*rate limited/i);
  });

  it("missing usage on response defaults all token counts to 0", async () => {
    const client = new ClaudeApiClient({ apiKey: "test-key" });
    const create = getMockCreate();
    create.mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      // no usage field
    });

    const r = await client.complete({ prompt: "x", model: "m", temperature: 0, maxTokens: 10 });

    expect(r.usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    });
  });

  it("joins multiple text content blocks with newlines", async () => {
    const client = new ClaudeApiClient({ apiKey: "test-key" });
    const create = getMockCreate();
    create.mockResolvedValue({
      content: [
        { type: "text", text: "line one" },
        { type: "text", text: "line two" },
      ],
      usage: { input_tokens: 1, output_tokens: 2 },
    });

    const r = await client.complete({ prompt: "x", model: "m", temperature: 0, maxTokens: 10 });

    expect(r.text).toBe("line one\nline two");
  });

  it("provider id is 'claude_api' and lists known models", () => {
    const c = new ClaudeApiClient({ apiKey: "x" });
    expect(c.provider).toBe("claude_api");
    const ids = c.models.map((m) => m.id);
    expect(ids).toContain("claude-sonnet-4-6");
    expect(ids).toContain("claude-opus-4-7");
    expect(ids.some((id) => id.startsWith("claude-haiku-4-5"))).toBe(true);
  });
});
