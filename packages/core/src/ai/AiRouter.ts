import type { AiClient, AiCompletionInput, AiCompletionResult } from "./AiClient.js";

const MAX_ATTEMPTS = 4;
const BACKOFF_BASE_SEC = 2;

export interface AiRouterOptions {
  primary: AiClient;
  fallback?: AiClient;
  /** Override for tests so they don't actually wait. */
  sleepMs?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Wraps a primary AiClient (and optional fallback) with retry-on-failure.
 * Each client gets up to MAX_ATTEMPTS attempts with exponential backoff
 * (2s, 4s, 8s — no wait after the final attempt).
 *
 * If primary exhausts its retries and fallback is configured, fallback gets
 * the same treatment. If both fail, throws a combined error with both
 * provider ids and last error messages.
 *
 * Mirrors V:/JTrakProject/backend/analyzer/llm_client.py call_llm() loop.
 */
export class AiRouter {
  constructor(private readonly opts: AiRouterOptions) {}

  /** The primary client's provider id, exposed for logging. */
  get primaryProvider(): string {
    return this.opts.primary.provider;
  }

  /**
   * The primary AiClient. Exposed so callers that need direct `AiClient`
   * access (e.g. the LLM parser) can use it without going through the
   * retry/fallback wrapper. Callers that want retries should keep calling
   * `complete()` on the router itself.
   */
  get primaryClient(): AiClient {
    return this.opts.primary;
  }

  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    const sleep = this.opts.sleepMs ?? defaultSleep;
    const primaryOutcome = await this.tryWithRetries(this.opts.primary, input, sleep);
    if (!(primaryOutcome instanceof Error)) return primaryOutcome;

    if (this.opts.fallback) {
      const fallbackOutcome = await this.tryWithRetries(this.opts.fallback, input, sleep);
      if (!(fallbackOutcome instanceof Error)) return fallbackOutcome;
      throw new Error(
        `Both providers failed after ${MAX_ATTEMPTS} attempts each. ` +
          `Primary (${this.opts.primary.provider}): ${primaryOutcome.message}. ` +
          `Fallback (${this.opts.fallback.provider}): ${fallbackOutcome.message}`,
      );
    }
    throw primaryOutcome;
  }

  private async tryWithRetries(
    client: AiClient,
    input: AiCompletionInput,
    sleep: (ms: number) => Promise<void>,
  ): Promise<AiCompletionResult | Error> {
    let lastErr: Error | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await client.complete(input);
      } catch (err) {
        lastErr = err as Error;
        if (attempt < MAX_ATTEMPTS) {
          const wait = BACKOFF_BASE_SEC ** attempt * 1000;
          await sleep(wait);
        }
      }
    }
    return lastErr ?? new Error("provider failed without an error object");
  }
}
