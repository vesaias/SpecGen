import type { AdfDoc, ConfluenceCredentials } from "./types.js";

/**
 * Confluence Cloud REST API v2 client — thin Fetch wrapper, no third-party HTTP dep.
 *
 * Auth: HTTP Basic with `email:apiToken` base64-encoded. The API token is
 * issued via id.atlassian.com → API tokens; this is the only auth flow we
 * support in v0.2 (OAuth is Phase F per decision F5).
 *
 * Body representation: `atlas_doc_format` — the ADF JSON is serialised to a
 * string and embedded inside `body.value`. This is the only representation
 * that round-trips reliably for non-trivial structures.
 *
 * Endpoints:
 *   - GET    /wiki/api/v2/spaces?keys=<KEY>&limit=1   → find a space by key
 *   - POST   /wiki/api/v2/pages                       → create a page
 *   - PUT    /wiki/api/v2/pages/{id}                  → update (bumps version+1)
 *   - DELETE /wiki/api/v2/pages/{id}                  → archive (soft, reversible)
 *   - GET    /wiki/api/v2/pages/{id}                  → fetch for drift detection
 *
 * Site URL normalisation: trailing slashes on `baseUrl` are stripped at the
 * `json()` boundary so callers can pass `https://x.atlassian.net` OR
 * `https://x.atlassian.net/`. We deliberately do NOT strip a trailing `/wiki`
 * — the caller is expected to pass the bare site URL.
 */
export class ConfluenceClient {
  constructor(private readonly creds: ConfluenceCredentials) {}

  /** Public so the push service can build resolved-link URLs. */
  get baseUrl(): string {
    return this.creds.baseUrl.replace(/\/+$/, "");
  }

  private auth(): string {
    return `Basic ${Buffer.from(`${this.creds.email}:${this.creds.apiToken}`).toString("base64")}`;
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/wiki${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: this.auth(),
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "<no body>");
      throw new Error(`Confluence ${init.method ?? "GET"} ${path} → ${res.status}: ${body}`);
    }
    // DELETE returns 204 No Content — no JSON to parse.
    if (res.status === 204) return undefined as unknown as T;
    return (await res.json()) as T;
  }

  /**
   * Look up a space by its key. Throws if not found — surfacing the error to
   * the REST handler is fine since this is also our `test connection` ping.
   */
  async findSpace(key: string): Promise<{ id: string; key: string }> {
    const r = await this.json<{ results: Array<{ id: string; key: string }> }>(
      `/api/v2/spaces?keys=${encodeURIComponent(key)}&limit=1`,
    );
    const first = r.results[0];
    if (!first) throw new Error(`Confluence space not found: ${key}`);
    return first;
  }

  async createPage(input: {
    spaceId: string;
    title: string;
    parentId?: string;
    adfBody: AdfDoc;
  }): Promise<{ id: string; version: { number: number } }> {
    return this.json("/api/v2/pages", {
      method: "POST",
      body: JSON.stringify({
        spaceId: input.spaceId,
        status: "current",
        title: input.title,
        parentId: input.parentId,
        body: {
          representation: "atlas_doc_format",
          value: JSON.stringify(input.adfBody),
        },
      }),
    });
  }

  async updatePage(input: {
    id: string;
    version: number;
    title: string;
    adfBody: AdfDoc;
  }): Promise<{ id: string; version: { number: number } }> {
    return this.json(`/api/v2/pages/${input.id}`, {
      method: "PUT",
      body: JSON.stringify({
        id: input.id,
        status: "current",
        title: input.title,
        version: { number: input.version + 1, message: "SpecGen sync" },
        body: {
          representation: "atlas_doc_format",
          value: JSON.stringify(input.adfBody),
        },
      }),
    });
  }

  /**
   * Re-parent an existing page. Used by the tree-aware push when the user has
   * moved an item between folders in the SpecGen sidebar: the page is already
   * created (and may have manually-edited content in Confluence) but the
   * Confluence parent needs to follow the new tree position.
   *
   * Confluence's v2 PUT requires the full page envelope; we omit the body
   * payload so the stored ADF content is preserved verbatim by the server.
   * Version is bumped per the same convention as updatePage.
   */
  async updatePageParent(input: {
    id: string;
    version: number;
    title: string;
    parentId: string | undefined;
  }): Promise<{ id: string; version: { number: number } }> {
    return this.json(`/api/v2/pages/${input.id}`, {
      method: "PUT",
      body: JSON.stringify({
        id: input.id,
        status: "current",
        title: input.title,
        parentId: input.parentId,
        version: { number: input.version + 1, message: "SpecGen tree move" },
      }),
    });
  }

  /**
   * DELETE on /pages/{id} puts the page in the trash (status:'trashed'),
   * which is reversible — restoring the page in the Confluence UI brings it
   * back. Hard-delete requires `purge=true` and is intentionally out of scope.
   */
  async archivePage(id: string): Promise<void> {
    await this.json(`/api/v2/pages/${id}`, { method: "DELETE" });
  }

  /** Fetch raw page metadata — used by future drift-detection (v0.3). */
  async getPage(id: string): Promise<{
    id: string;
    title: string;
    version: { number: number };
    status: string;
  }> {
    return this.json(`/api/v2/pages/${id}`);
  }
}
