/** Standard usage shape returned by every provider. Mirrors JobNavigator. */
export interface AiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export interface AiCompletionInput {
  prompt: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /** Optional system prompt distinct from the user prompt. */
  system?: string;
  /**
   * Optional cached prefix for prompt caching.
   * Honoured natively by claude_api (sent as cache_control: ephemeral block).
   * Other providers concatenate it into the prompt (no cache discount).
   */
  cachedPrefix?: string;
  /** Optional metadata for tracing / logging. */
  metadata?: Record<string, unknown>;
  /**
   * Optional AbortSignal — when fired, providers should abort the in-flight
   * request as soon as possible. Plumbed by RunWorker so user-initiated
   * `Cancel` actually interrupts long-running AI calls instead of waiting
   * for the call to complete and only then checking the cancellation flag
   * between generator yields.
   */
  signal?: AbortSignal;
}

export interface AiCompletionResult {
  text: string;
  usage: AiUsage;
  /** Raw provider response, for debugging / forensics. */
  raw?: unknown;
}

export interface AiClientModel {
  id: string;
  displayName: string;
  /** USD per million input tokens; omitted for subscription-based providers. */
  costPer1MIn?: number;
  /** USD per million output tokens; omitted for subscription-based providers. */
  costPer1MOut?: number;
  /** Total context window in tokens, if known. */
  contextWindow?: number;
}

export interface AiClient {
  /** Provider id: 'local' | 'claude_api' | 'claude_code' | 'openai' | 'openai_compat' | 'ollama' */
  readonly provider: string;
  /** Models the provider supports (best-effort; user may override). */
  readonly models: ReadonlyArray<AiClientModel>;
  complete(input: AiCompletionInput): Promise<AiCompletionResult>;
}

export type ProviderId =
  | "local"
  | "claude_api"
  | "claude_code"
  | "openai"
  | "openai_compat"
  | "ollama";
