import type { Db } from "../db/sqlite.js";
import { isValidSlug, slugify } from "../services/slugify.js";
import { ulid } from "../services/ulid.js";
import type {
  CreateProjectInput,
  Project,
  ProjectRow,
  ProjectSource,
  UpdateProjectInput,
} from "../types/Project.js";

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    source: JSON.parse(row.source_config_json) as ProjectSource,
    parsers: JSON.parse(row.parsers_json) as string[],
    parserConfig: JSON.parse(row.parser_config_json) as Record<string, unknown>,
    ai: JSON.parse(row.ai_json) as Record<string, unknown>,
    connectors: JSON.parse(row.connectors_json) as Record<string, unknown>,
    exports: JSON.parse(row.exports_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastParsedAt: row.last_parsed_at,
    lastParseRunId: row.last_parse_run_id,
  };
}

export class SqliteProjectRepository {
  constructor(private readonly db: Db) {}

  create(input: CreateProjectInput): Project {
    if (!input.name || typeof input.name !== "string") {
      const e = new Error("name is required") as Error & { status: number };
      e.status = 400;
      throw e;
    }
    if (!input.source || typeof input.source !== "object") {
      const e = new Error("source is required") as Error & { status: number };
      e.status = 400;
      throw e;
    }
    const slug = input.slug ?? slugify(input.name);
    if (!isValidSlug(slug)) {
      const e = new Error(`Invalid slug: "${slug}"`) as Error & { status: number };
      e.status = 400;
      throw e;
    }

    const existing = this.findBySlug(slug);
    if (existing) {
      const e = new Error(`Project with slug "${slug}" already exists`) as Error & {
        status: number;
      };
      e.status = 409;
      throw e;
    }

    const id = ulid();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO projects (
        id, slug, name, description, icon, source_type, source_config_json,
        parsers_json, parser_config_json, ai_json, connectors_json, exports_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      slug,
      input.name,
      input.description ?? null,
      input.icon ?? null,
      input.source.type,
      JSON.stringify(input.source),
      JSON.stringify(input.parsers ?? []),
      JSON.stringify(input.parserConfig ?? {}),
      JSON.stringify(input.ai ?? {}),
      JSON.stringify(input.connectors ?? {}),
      JSON.stringify(input.exports ?? {}),
      now,
      now,
    );
    const row = this.db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(id) as unknown as ProjectRow;
    return rowToProject(row);
  }

  findById(id: string): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as unknown as
      | ProjectRow
      | undefined;
    return row ? rowToProject(row) : null;
  }

  findBySlug(slug: string): Project | null {
    const row = this.db.prepare("SELECT * FROM projects WHERE slug = ?").get(slug) as unknown as
      | ProjectRow
      | undefined;
    return row ? rowToProject(row) : null;
  }

  list(): Project[] {
    const rows = this.db
      .prepare("SELECT * FROM projects ORDER BY created_at DESC")
      .all() as unknown as ProjectRow[];
    return rows.map(rowToProject);
  }

  update(slug: string, input: UpdateProjectInput): Project | null {
    const existing = this.findBySlug(slug);
    if (!existing) return null;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE projects
         SET name = COALESCE(?, name),
             description = ?,
             icon = ?,
             parsers_json = ?,
             parser_config_json = ?,
             ai_json = ?,
             connectors_json = ?,
             exports_json = ?,
             updated_at = ?
       WHERE id = ?
    `);
    stmt.run(
      input.name ?? null,
      input.description !== undefined ? input.description : existing.description,
      input.icon !== undefined ? input.icon : existing.icon,
      JSON.stringify(input.parsers ?? existing.parsers),
      JSON.stringify(input.parserConfig ?? existing.parserConfig),
      JSON.stringify(input.ai ?? existing.ai),
      JSON.stringify(input.connectors ?? existing.connectors),
      JSON.stringify(input.exports ?? existing.exports),
      now,
      existing.id,
    );
    return this.findBySlug(slug);
  }

  delete(slug: string): boolean {
    const r = this.db.prepare("DELETE FROM projects WHERE slug = ?").run(slug);
    return r.changes > 0;
  }

  markParsed(projectId: string, at: Date = new Date()): void {
    this.db
      .prepare("UPDATE projects SET last_parsed_at = ?, updated_at = ? WHERE id = ?")
      .run(at.toISOString(), at.toISOString(), projectId);
  }

  /**
   * Update the GitHub commit poller's "last seen sha" for a project. Bumped on
   * every successful poll tick (regardless of whether a run was triggered), so
   * the next tick can compare against the freshest known sha.
   */
  setGithubLastSeenSha(projectId: string, sha: string | null): void {
    this.db
      .prepare("UPDATE projects SET github_last_seen_sha = ?, updated_at = ? WHERE id = ?")
      .run(sha, new Date().toISOString(), projectId);
  }

  /** Read the poller's last-seen sha. NULL means the project has never been polled. */
  getGithubLastSeenSha(projectId: string): string | null {
    const row = this.db
      .prepare("SELECT github_last_seen_sha FROM projects WHERE id = ?")
      .get(projectId) as { github_last_seen_sha: string | null } | undefined;
    return row?.github_last_seen_sha ?? null;
  }
}
