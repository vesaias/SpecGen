export interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  source_type: "local" | "github";
  source_config_json: string;
  parsers_json: string;
  parser_config_json: string;
  ai_json: string;
  connectors_json: string;
  exports_json: string;
  created_at: string;
  updated_at: string;
  last_parsed_at: string | null;
  last_parse_run_id: string | null;
}

export interface ProjectSourceLocal {
  type: "local";
  localPath: string;
}

export interface ProjectSourceGitHub {
  type: "github";
  owner: string;
  repo: string;
  ref: string;
}

export type ProjectSource = ProjectSourceLocal | ProjectSourceGitHub;

/**
 * Hydrated Project — JSON columns parsed.
 * The shape returned by the API and consumed by the webapp.
 */
export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  source: ProjectSource;
  parsers: string[];
  parserConfig: Record<string, unknown>;
  ai: Record<string, unknown>;
  connectors: Record<string, unknown>;
  exports: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastParsedAt: string | null;
  lastParseRunId: string | null;
}

export interface CreateProjectInput {
  name: string;
  slug?: string; // optional; auto-derived if omitted
  description?: string;
  icon?: string;
  source: ProjectSource;
  parsers?: string[];
  parserConfig?: Record<string, unknown>;
  ai?: Record<string, unknown>;
  connectors?: Record<string, unknown>;
  exports?: Record<string, unknown>;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  icon?: string | null;
  parsers?: string[];
  parserConfig?: Record<string, unknown>;
  ai?: Record<string, unknown>;
  connectors?: Record<string, unknown>;
  exports?: Record<string, unknown>;
}
