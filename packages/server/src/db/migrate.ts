import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Db } from "./sqlite.js";

/**
 * Apply any pending migrations from the given directory.
 * Migrations are SQL files named like `NNN_description.sql` where NNN is an integer.
 * Each migration is applied at most once; tracked in schema_migrations.
 *
 * @param db - sqlite handle
 * @param migrationsDir - absolute path to a directory of *.sql files
 */
export function migrate(db: Db, migrationsDir: string): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version INTEGER PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  );
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const appliedRows = db.prepare("SELECT version FROM schema_migrations").all() as {
    version: number;
  }[];
  const applied = new Set(appliedRows.map((r) => r.version));
  const insertVersion = db.prepare("INSERT INTO schema_migrations (version) VALUES (?)");

  for (const f of files) {
    const versionStr = f.split("_")[0];
    const version = Number.parseInt(versionStr ?? "", 10);
    if (Number.isNaN(version)) continue;
    if (applied.has(version)) continue;

    const sql = readFileSync(path.join(migrationsDir, f), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      insertVersion.run(version);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${f} failed: ${(err as Error).message}`);
    }
  }
}
