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

async function httpText(path: string): Promise<string> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  return res.text();
}

async function patchText(path: string, body: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "text/plain" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
}

export interface ProfileSummary {
  id: string;
  name: string;
  description?: string;
  source: "packaged" | "project";
}

export interface ProfileManifest {
  schemaVersion: number;
  id: string;
  name: string;
  description?: string;
  version: string;
  extends: string | null;
  audience: string[];
  supports_generators: string[];
  supports_item_types: string[];
  ai: {
    default_model: string;
    default_temperature: number;
    default_max_tokens: number;
    default_concurrency: number;
  };
  output: { language: string; block_types_allowlist: string[] | null };
  keywords: string[];
  author?: string;
  license: string;
}

export interface ProfileDetail {
  manifest: ProfileManifest;
  files: string[];
  inheritanceChain: string[];
}

export const profilesApi = {
  list: () => http<ProfileSummary[]>("/profiles"),
  get: (id: string) => http<ProfileDetail>(`/profiles/${id}`),
  getFile: (id: string, relPath: string) =>
    httpText(`/profiles/${id}/file?path=${encodeURIComponent(relPath)}`),

  fork: (slug: string, profileId: string) =>
    http<{ ok: boolean; path: string }>(`/projects/${slug}/profiles/${profileId}/fork`, {
      method: "POST",
    }),
  patchFile: (slug: string, profileId: string, relPath: string, content: string) =>
    patchText(
      `/projects/${slug}/profiles/${profileId}/file?path=${encodeURIComponent(relPath)}`,
      content,
    ),
  deleteFile: (slug: string, profileId: string, relPath: string) =>
    http<void>(`/projects/${slug}/profiles/${profileId}/file?path=${encodeURIComponent(relPath)}`, {
      method: "DELETE",
    }),
  deleteProfile: (slug: string, profileId: string) =>
    http<void>(`/projects/${slug}/profiles/${profileId}`, { method: "DELETE" }),
};
