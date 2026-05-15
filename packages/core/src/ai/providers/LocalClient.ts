import type {
  AiClient,
  AiClientModel,
  AiCompletionInput,
  AiCompletionResult,
} from "../AiClient.js";

export interface LocalClientOptions {
  /** 'normal' returns a stub describing the prompt; 'empty' returns ''; 'error' throws. */
  mode?: "normal" | "empty" | "error";
}

/** Approximate token count: 1 token ≈ 4 chars. */
function tokenize(s: string): number {
  return Math.max(1, Math.ceil(s.length / 4));
}

export class LocalClient implements AiClient {
  readonly provider = "local";
  readonly models: ReadonlyArray<AiClientModel> = [
    { id: "stub", displayName: "Local stub (deterministic)" },
  ];

  constructor(private readonly opts: LocalClientOptions = {}) {}

  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    if (this.opts.mode === "error") {
      throw new Error("simulated provider failure");
    }
    if (this.opts.mode === "empty") {
      return {
        text: "",
        usage: {
          input_tokens: tokenize(input.prompt),
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        },
      };
    }
    const echoed = input.prompt.slice(0, 200);
    const text = `[stub output for prompt: "${echoed}"]\n\n(Local provider — no real model was called.)`;
    return {
      text,
      usage: {
        input_tokens: tokenize(input.prompt),
        output_tokens: tokenize(text),
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      },
    };
  }
}
