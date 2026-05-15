import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/migrate.js";
import { openDb } from "../../src/db/sqlite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../src/db/migrations");

let dbPath: string;

beforeEach(() => {
  const dir = mkdtempSync(path.join(tmpdir(), "specgen-migrate-"));
  dbPath = path.join(dir, "test.db");
});

describe("migrate", () => {
  it("creates schema_migrations and applies 001_init", () => {
    const db = openDb(dbPath);
    migrate(db, MIGRATIONS_DIR);
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("projects");
    expect(names).toContain("runs");
    expect(names).toContain("users");
    expect(names).toContain("sessions");
    expect(names).toContain("connector_tokens");
    expect(names).toContain("api_tokens");
    expect(names).toContain("confluence_page_map");
    expect(names).toContain("schema_migrations");
    db.close();
  });

  it("records the migration version in schema_migrations", () => {
    const db = openDb(dbPath);
    migrate(db, MIGRATIONS_DIR);
    const rows = db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[];
    expect(rows.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6]);
    db.close();
  });

  it("is idempotent (running twice does not error or duplicate rows)", () => {
    const db = openDb(dbPath);
    migrate(db, MIGRATIONS_DIR);
    migrate(db, MIGRATIONS_DIR);
    const rows = db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[];
    expect(rows).toHaveLength(6);
    db.close();
  });

  it("creates the items_fts virtual table for full-text search", () => {
    const db = openDb(dbPath);
    migrate(db, MIGRATIONS_DIR);
    // Insert + query via FTS to confirm it is functional
    db.prepare(
      "INSERT INTO items_fts (project_id, item_id, title, body_text) VALUES (?, ?, ?, ?)",
    ).run("p1", "i1", "Order Detail", "View customer orders here");
    const r = db.prepare("SELECT item_id FROM items_fts WHERE items_fts MATCH 'orders'").get() as
      | { item_id: string }
      | undefined;
    expect(r?.item_id).toBe("i1");
    db.close();
  });

  it("enforces foreign keys via cascade delete", () => {
    const db = openDb(dbPath);
    migrate(db, MIGRATIONS_DIR);
    db.prepare(
      "INSERT INTO projects (id, slug, name, source_type, source_config_json) VALUES (?, ?, ?, ?, ?)",
    ).run("p1", "project-1", "Project 1", "local", "{}");
    db.prepare(
      "INSERT INTO runs (id, project_id, generator_id, profile_id, status) VALUES (?, ?, ?, ?, ?)",
    ).run("r1", "p1", "full-tree-spec", "pm-spec", "success");
    db.prepare("DELETE FROM projects WHERE id = ?").run("p1");
    const remaining = db.prepare("SELECT id FROM runs").all();
    expect(remaining).toHaveLength(0);
    db.close();
  });
});
