import Anthropic from "@anthropic-ai/sdk";
import type {
  AiClient,
  AiClientModel,
  AiCompletionInput,
  AiCompletionResult,
} from "../AiClient.js";
import { PermanentAiError } from "../AiRouter.js";

/** HTTP status codes the router should NOT retry. 401/403 = bad/missing creds;
 *  400 = bad request (typically content-policy or prompt-too-long); 404 = model
 *  / endpoint not found; 422 = unprocessable entity. Everything else (5xx,
 *  429, network) stays in the retry path. */
const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 422]);

export interface ClaudeApiClientOptions {
  apiKey: string;
  baseUrl?: string;
}

export class ClaudeApiClient implements AiClient {
  readonly provider = "claude_api";
  readonly models: ReadonlyArray<AiClientModel> = [
    { id: "claude-opus-4-7", displayName: "Claude Opus 4.7", costPer1MIn: 15, costPer1MOut: 75 },
    { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", costPer1MIn: 3, costPer1MOut: 15 },
    {
      id: "claude-haiku-4-5-20251001",
      displayName: "Claude Haiku 4.5",
      costPer1MIn: 1,
      costPer1MOut: 5,
    },
  ];

  private readonly sdk: Anthropic;

  constructor(opts: ClaudeApiClientOptions) {
    this.sdk = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseUrl });
  }

  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    try {
      const content = input.cachedPrefix
        ? [
            {
              type: "text" as const,
              text: input.cachedPrefix,
              cache_control: { type: "ephemeral" as const },
            },
            { type: "text" as const, text: input.prompt },
          ]
        : input.prompt;

      const res = await this.sdk.messages.create(
        {
          model: input.model,
          max_tokens: input.maxTokens,
          temperature: input.temperature,
          system: input.system,
          messages: [{ role: "user", content }],
        },
        { signal: input.signal },
      );

      const text = res.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n");

      const u = res.usage;
      return {
        text,
        usage: {
          input_tokens: u?.input_tokens ?? 0,
          output_tokens: u?.output_tokens ?? 0,
          cache_read_tokens:
            (u as { cache_read_input_tokens?: number } | undefined)?.cache_read_input_tokens ?? 0,
          cache_write_tokens:
            (u as { cache_creation_input_tokens?: number } | undefined)
              ?.cache_creation_input_tokens ?? 0,
        },
        raw: res,
      };
    } catch (err) {
      const e = err as { status?: number; message?: string };
      const message = `claude_api: ${e.message ?? String(err)}`;
      if (typeof e.status === "number" && PERMANENT_STATUSES.has(e.status)) {
        throw new PermanentAiError(message, { status: e.status, provider: "claude_api" });
      }
      throw new Error(message);
    }
  }
}
