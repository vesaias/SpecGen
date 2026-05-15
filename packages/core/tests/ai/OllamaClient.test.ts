import { beforeEach, describe, expect, it, vi } from "vitest";
import { OllamaClient } from "../../src/ai/providers/OllamaClient.js";

beforeEach(() => {
  vi.restoreAllMocks();
});

function fakeFetchResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

describe("OllamaClient", () => {
  it("POSTs to default localhost:11434 endpoint", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        fakeFetchResponse({ response: "hello", prompt_eval_count: 10, eval_count: 5 }),
      );

    const r = await new OllamaClient().complete({
      prompt: "Describe X",
      model: "llama3",
      temperature: 0.2,
      maxTokens: 100,
    });

    expect(r.text).toBe("hello");
    expect(r.usage).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:11434/api/generate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sends body with model, prompt, system, stream:false, options", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        fakeFetchResponse({ response: "ok", prompt_eval_count: 1, eval_count: 1 }),
      );

    await new OllamaClient().complete({
      prompt: "user prompt",
      system: "system prompt",
      model: "llama3",
      temperature: 0.3,
      maxTokens: 256,
    });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("llama3");
    expect(body.prompt).toBe("user prompt");
    expect(body.system).toBe("system prompt");
    expect(body.stream).toBe(false);
    expect(body.options.num_predict).toBe(256);
    expect(body.options.temperature).toBe(0.3);
  });

  it("concatenates cachedPrefix into prompt (no native caching)", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        fakeFetchResponse({ response: "ok", prompt_eval_count: 1, eval_count: 1 }),
      );

    await new OllamaClient().complete({
      prompt: "user prompt",
      cachedPrefix: "Prior context.",
      model: "llama3",
      temperature: 0,
      maxTokens: 100,
    });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.prompt).toBe("Prior context.\n\nuser prompt");
  });

  it("respects custom baseUrl option", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        fakeFetchResponse({ response: "ok", prompt_eval_count: 1, eval_count: 1 }),
      );

    await new OllamaClient({ baseUrl: "http://example.com:9999" }).complete({
      prompt: "x",
      model: "llama3",
      temperature: 0,
      maxTokens: 100,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://example.com:9999/api/generate",
      expect.anything(),
    );
  });

  it("throws on non-ok HTTP response with status + body", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      fakeFetchResponse({ error: "model not found" }, false, 404),
    );

    await expect(
      new OllamaClient().complete({
        prompt: "x",
        model: "missing",
        temperature: 0,
        maxTokens: 100,
      }),
    ).rejects.toThrow(/ollama.*404/i);
  });

  it("missing usage fields default to 0", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(fakeFetchResponse({ response: "ok" }));

    const r = await new OllamaClient().complete({
      prompt: "x",
      model: "llama3",
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

  it("trims whitespace from response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      fakeFetchResponse({ response: "  hello world  \n", prompt_eval_count: 1, eval_count: 2 }),
    );

    const r = await new OllamaClient().complete({
      prompt: "x",
      model: "llama3",
      temperature: 0,
      maxTokens: 10,
    });
    expect(r.text).toBe("hello world");
  });

  it("provider id is 'ollama' and lists local models", () => {
    const c = new OllamaClient();
    expect(c.provider).toBe("ollama");
    expect(c.models.length).toBeGreaterThan(0);
    expect(c.models[0].id).toBeTruthy();
  });
});
