import {
  AiRouter,
  ClaudeApiClient,
  ClaudeCodeClient,
  LocalClient,
  OllamaClient,
  OpenAIClient,
} from "@specgen/core";
import type { AiClient } from "@specgen/core";

export interface ProviderConfig {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Build a single AiClient from a config. Throws if a required env var is missing.
 * Defaults to LocalClient when provider is unset/unknown.
 */
export function buildAiClient(cfg: ProviderConfig): AiClient {
  switch (cfg.provider) {
    case "claude_api": {
      const key = cfg.apiKey ?? process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("claude_api: ANTHROPIC_API_KEY not set");
      return new ClaudeApiClient({ apiKey: key, baseUrl: cfg.baseUrl });
    }
    case "claude_code":
      return new ClaudeCodeClient();
    case "openai": {
      const key = cfg.apiKey ?? process.env.OPENAI_API_KEY;
      if (!key) throw new Error("openai: OPENAI_API_KEY not set");
      return new OpenAIClient({ apiKey: key, providerId: "openai" });
    }
    case "openai_compat": {
      const key = cfg.apiKey ?? process.env.OPENAI_API_KEY;
      if (!key) throw new Error("openai_compat: API key not set");
      if (!cfg.baseUrl) throw new Error("openai_compat: baseUrl required");
      return new OpenAIClient({ apiKey: key, baseUrl: cfg.baseUrl, providerId: "openai_compat" });
    }
    case "ollama":
      return new OllamaClient({ baseUrl: cfg.baseUrl });
    default:
      return new LocalClient();
  }
}

/**
 * Build an AiRouter from primary and optional fallback configs.
 */
export function buildAiRouter(primary: ProviderConfig, fallback?: ProviderConfig): AiRouter {
  const primaryClient = buildAiClient(primary);
  const fallbackClient = fallback?.provider ? buildAiClient(fallback) : undefined;
  return new AiRouter({ primary: primaryClient, fallback: fallbackClient });
}
