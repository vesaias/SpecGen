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
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface RunRow {
  id: string;
  project_id: string;
  generator_id: string;
  /**
   * Human-readable generator name (from `GeneratorPlugin.name`). Resolved
   * server-side at response time via the generator registry; absent when
   * the registry has no plugin matching `generator_id` (rare — happens
   * for runs whose generator was removed since the run was recorded).
   */
  generator_name?: string;
  profile_id: string;
  status: "queued" | "running" | "success" | "failed" | "cancelled" | "interrupted";
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  error_text: string | null;
  log_path: string | null;
  created_at: string;
  stats: {
    itemsCreated: number;
    itemsUpdated: number;
    itemsRemoved: number;
    warnings: number;
    aiCalls: Array<{
      itemId: string;
      provider: string;
      model: string;
      durationMs: number;
      costUsd: number;
      status: string;
      error?: string;
    }>;
    aiCostUsdTotal: number;
  };
}

export type RunEvent =
  | { type: "progress"; message: string }
  | { type: "item-updated"; itemId: string }
  | { type: "warning"; message: string }
  | { type: "error"; error: { message?: string } }
  | { type: "done"; stats: RunRow["stats"] };

export const runsApi = {
  enqueue: (
    slug: string,
    body: {
      generator?: string;
      profile?: string;
      options?: Record<string, unknown>;
    } = {},
  ) =>
    http<{ runId: string; status: string }>(`/projects/${slug}/runs`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  list: (slug: string) => http<RunRow[]>(`/projects/${slug}/runs`),
  get: (id: string) => http<RunRow>(`/runs/${id}`),
  cancel: (id: string) => http<{ ok: boolean }>(`/runs/${id}/cancel`, { method: "POST" }),
  delete: (id: string) => http<void>(`/runs/${id}`, { method: "DELETE" }),

  /**
   * Subscribe to a run's SSE event stream. Returns a cleanup function.
   * The server emits named events ('progress', 'item-updated', 'warning', 'error', 'done'),
   * so we register a listener for each known type.
   */
  subscribe(id: string, onEvent: (event: RunEvent) => void): () => void {
    const source = new EventSource(`${API_BASE}/runs/${id}/events`);
    const types: RunEvent["type"][] = ["progress", "item-updated", "warning", "error", "done"];
    for (const t of types) {
      source.addEventListener(t, (e) => {
        try {
          onEvent(JSON.parse((e as MessageEvent).data) as RunEvent);
        } catch {
          // malformed event — ignore
        }
      });
    }
    source.onerror = () => {
      // The browser will auto-reconnect; for finished runs the server closes the
      // connection which surfaces as an error. Always close to prevent retry loops.
      source.close();
    };
    return () => source.close();
  },
};
