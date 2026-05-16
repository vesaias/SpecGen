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
 * Marker error class. Providers throw this when the failure is NOT worth
 * retrying — bad auth, malformed request, content-policy refusal, model not
 * found. The router skips the per-attempt backoff and the fallback chain
 * for these.
 *
 * Anything an attacker / mistake / quota issue might recover from (rate
 * limit, transient 5xx, timeout, network hiccup) is a regular Error and
 * passes through the standard retry path.
 */
export class PermanentAiError extends Error {
  readonly isPermanentAiError = true;
  readonly status?: number;
  readonly provider?: string;
  constructor(message: string, opts: { status?: number; provider?: string } = {}) {
    super(message);
    this.name = "PermanentAiError";
    this.status = opts.status;
    this.provider = opts.provider;
  }
}

function isPermanent(err: unknown): err is PermanentAiError {
  return Boolean(
    err &&
      typeof err === "object" &&
      "isPermanentAiError" in err &&
      (err as PermanentAiError).isPermanentAiError === true,
  );
}

/**
 * Wraps a primary AiClient (and optional fallback) with retry-on-failure.
 * Each client gets up to MAX_ATTEMPTS attempts with exponential backoff
 * (2s, 4s, 8s — no wait after the final attempt).
 *
 * If primary exhausts its retries and fallback is configured, fallback gets
 * the same treatment. If both fail, throws a combined error with both
 * provider ids and last error messages.
 *
 * Permanent errors (`PermanentAiError`) bypass retries AND skip the
 * fallback — re-trying a 401 four times on each of two providers wastes
 * ~28s wall time per item with no chance of recovery. Throw early instead.
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

    // Permanent failures (4xx auth / content-policy / bad-request) skip the
    // fallback. Retrying a revoked API key on a second provider doesn't help
    // and costs another 14s of backoff before failing.
    if (isPermanent(primaryOutcome)) throw primaryOutcome;
    // Aborted requests propagate immediately — no point trying the fallback
    // when the user clicked Cancel.
    if (input.signal?.aborted) throw primaryOutcome;

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
      // Bail out of the retry loop when the caller has aborted — there's no
      // point spending another backoff window on a request the user no
      // longer wants.
      if (input.signal?.aborted) {
        return new Error(`aborted before attempt ${attempt}`);
      }
      try {
        return await client.complete(input);
      } catch (err) {
        lastErr = err as Error;
        // Permanent errors short-circuit the retry loop AND propagate up so
        // complete() can decide whether to attempt the fallback. (It won't —
        // see isPermanent() check in complete().)
        if (isPermanent(err)) return err as Error;
        if (input.signal?.aborted) return err as Error;
        if (attempt < MAX_ATTEMPTS) {
          const wait = BACKOFF_BASE_SEC ** attempt * 1000;
          await sleep(wait);
        }
      }
    }
    return lastErr ?? new Error("provider failed without an error object");
  }
}
