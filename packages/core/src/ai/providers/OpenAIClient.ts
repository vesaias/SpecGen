import OpenAI from "openai";
import type {
  AiClient,
  AiClientModel,
  AiCompletionInput,
  AiCompletionResult,
} from "../AiClient.js";

export interface OpenAIClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** 'openai' for the public API, 'openai_compat' for self-hosted / Together / Groq / etc. */
  providerId?: "openai" | "openai_compat";
}

export class OpenAIClient implements AiClient {
  readonly provider: "openai" | "openai_compat";
  readonly models: ReadonlyArray<AiClientModel> = [
    { id: "gpt-4o", displayName: "GPT-4o", costPer1MIn: 2.5, costPer1MOut: 10 },
    { id: "gpt-4o-mini", displayName: "GPT-4o mini", costPer1MIn: 0.15, costPer1MOut: 0.6 },
    { id: "gpt-5", displayName: "GPT-5" },
  ];
  private readonly sdk: OpenAI;

  constructor(opts: OpenAIClientOptions) {
    this.provider = opts.providerId ?? "openai";
    this.sdk = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseUrl });
  }

  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    try {
      const messages: { role: "system" | "user"; content: string }[] = [];
      if (input.system) messages.push({ role: "system", content: input.system });
      // openai/openai_compat doesn't support cache_control; concatenate cachedPrefix into prompt
      const prompt = input.cachedPrefix ? `${input.cachedPrefix}\n\n${input.prompt}` : input.prompt;
      messages.push({ role: "user", content: prompt });

      const res = await this.sdk.chat.completions.create({
        model: input.model,
        max_tokens: input.maxTokens,
        temperature: input.temperature,
        messages,
      });
      const text = res.choices[0]?.message?.content ?? "";
      const u = res.usage;
      return {
        text: text.trim(),
        usage: {
          input_tokens: u?.prompt_tokens ?? 0,
          output_tokens: u?.completion_tokens ?? 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        },
        raw: res,
      };
    } catch (err) {
      throw new Error(`${this.provider}: ${(err as Error).message}`);
    }
  }
}
