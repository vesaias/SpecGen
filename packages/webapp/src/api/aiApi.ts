const API_BASE = "/api";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export interface ProviderModel {
  id: string;
  displayName: string;
  costPer1MIn?: number;
  costPer1MOut?: number;
}

export interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  subscriptionBased: boolean;
  requiresBaseUrl?: boolean;
  /** Server-supplied human-readable next step when not fully configured. */
  hint?: string;
  models: ProviderModel[];
}

export interface AiTestResult {
  provider: string;
  model: string;
  durationMs: number;
  costUsd: number;
  promptText: string;
  output: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
  };
}

export interface AiTestRequest {
  itemId?: string;
  prompt?: string;
}

export const aiApi = {
  listProviders: () => http<ProviderInfo[]>("/ai/providers"),
  test: (slug: string, body: AiTestRequest) =>
    http<AiTestResult>(`/projects/${slug}/ai/test`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};
