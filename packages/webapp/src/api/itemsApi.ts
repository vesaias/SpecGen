/**
 * itemsApi — wrappers for project-scoped item endpoints (Phase D, /api/v0/).
 *
 * Currently exposes the single-item re-enrich route added in Task 8 of the
 * AI enrichment pipeline plan.
 */

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

export interface EnrichItemBody {
  /** Run the bootstrap stage as well (default: false). */
  forceBootstrap?: boolean;
}

export const itemsApi = {
  /**
   * Enqueue a single-item enrichment run. Server returns 202 with the run id;
   * subscribe via `runsApi.subscribe(runId, ...)` to stream progress.
   */
  enrich: (slug: string, itemId: string, body: EnrichItemBody = {}) =>
    http<{ runId: string }>(
      `/v0/projects/${encodeURIComponent(slug)}/items/${encodeURIComponent(itemId)}/enrich`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
};
