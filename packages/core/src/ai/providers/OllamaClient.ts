import type {
  AiClient,
  AiClientModel,
  AiCompletionInput,
  AiCompletionResult,
} from "../AiClient.js";

export interface OllamaClientOptions {
  baseUrl?: string;
}

export class OllamaClient implements AiClient {
  readonly provider = "ollama";
  readonly models: ReadonlyArray<AiClientModel> = [
    { id: "llama3", displayName: "Llama 3" },
    { id: "qwen2.5-coder", displayName: "Qwen 2.5 Coder" },
  ];

  private readonly baseUrl: string;

  constructor(opts: OllamaClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "http://localhost:11434";
  }

  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    const prompt = input.cachedPrefix ? `${input.cachedPrefix}\n\n${input.prompt}` : input.prompt;

    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: input.model,
        prompt,
        system: input.system,
        stream: false,
        options: {
          num_predict: input.maxTokens,
          temperature: input.temperature,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ollama: HTTP ${res.status} ${body}`);
    }

    const data = (await res.json()) as {
      response?: string;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      text: (data.response ?? "").trim(),
      usage: {
        input_tokens: data.prompt_eval_count ?? 0,
        output_tokens: data.eval_count ?? 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
      },
      raw: data,
    };
  }
}
