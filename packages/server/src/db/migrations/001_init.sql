PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  source_type TEXT NOT NULL,
  source_config_json TEXT NOT NULL,
  parsers_json TEXT NOT NULL DEFAULT '[]',
  parser_config_json TEXT NOT NULL DEFAULT '{}',
  ai_json TEXT NOT NULL DEFAULT '{}',
  connectors_json TEXT NOT NULL DEFAULT '{}',
  exports_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_parsed_at TEXT,
  last_parse_run_id TEXT
);

CREATE INDEX idx_projects_slug ON projects(slug);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  generator_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER,
  stats_json TEXT NOT NULL DEFAULT '{}',
  error_text TEXT,
  log_path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_runs_project ON runs(project_id, created_at DESC);

CREATE TABLE connector_tokens (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  scope TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_connector_tokens ON connector_tokens(project_id, connector_id);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  github_login TEXT UNIQUE,
  display_name TEXT,
  password_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hash TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE items_fts USING fts5(
  project_id UNINDEXED,
  item_id UNINDEXED,
  title,
  body_text,
  tokenize = 'porter unicode61'
);
