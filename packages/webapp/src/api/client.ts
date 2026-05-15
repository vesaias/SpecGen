import type { CreateProjectInput, Project, UpdateProjectInput } from "@specgen/server";

const API_BASE = "/api";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Probe types (mirrors packages/server/src/services/probeProject.ts)
// ---------------------------------------------------------------------------

export interface ParserMatch {
  parser: string;
  confidence: number;
  atSubdir?: string;
}

export interface ParserRejection {
  parser: string;
  reason: string;
  lookedAt: string[];
}

export interface LanguageInfo {
  language: string;
  fileCount: number;
  parserAvailable: boolean;
}

/** One project root the AI classifier identified. */
export interface ClassifiedProject {
  kind: string;
  rootDir: string;
  framework: string;
  confidence: number;
  suggestedParsers: string[];
  notes: string;
}

export interface ProjectClassification {
  projects: ClassifiedProject[];
  summary: string;
}

export interface DetectReport {
  canParse: boolean;
  matches: ParserMatch[];
  rejected: ParserRejection[];
  languagesDetected: LanguageInfo[];
  suggestedProfile: string;
  suggestedParsers: string[];
  /** Optional AI classification. null if no server AI configured or AI failed. */
  aiClassification?: ProjectClassification | null;
}

export type ProbeSource =
  | { type: "local"; localPath: string }
  | { type: "github"; owner: string; repo: string; ref?: string; token: string };

export interface ProbeInput {
  source: ProbeSource;
}

// ---------------------------------------------------------------------------
// API clients
// ---------------------------------------------------------------------------

export const projectsApi = {
  list: () => http<Project[]>("/projects"),
  get: (slug: string) => http<Project>(`/projects/${slug}`),
  create: (input: CreateProjectInput) =>
    http<Project>("/projects", { method: "POST", body: JSON.stringify(input) }),
  update: (slug: string, input: UpdateProjectInput) =>
    http<Project>(`/projects/${slug}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  delete: (slug: string) => http<void>(`/projects/${slug}`, { method: "DELETE" }),
  /** Pre-flight detection probe — does NOT persist anything. */
  probe: (input: ProbeInput) =>
    http<DetectReport>("/v0/projects/probe", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};

export interface SpecResponse {
  meta: Record<string, unknown>;
  tree: unknown[];
  items: Record<string, { id: string; type: string; title: string }>;
}

export const specApi = {
  get: (slug: string) => http<SpecResponse>(`/projects/${slug}/spec`),
};
