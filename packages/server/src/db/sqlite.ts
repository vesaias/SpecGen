import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

/**
 * Open a sqlite database with sensible defaults for this app:
 *   - WAL journal mode (concurrent reads while writing)
 *   - Foreign keys enforced
 */
export function openDb(filePath: string): Db {
  const db = new DatabaseSync(filePath, { enableForeignKeyConstraints: true });
  db.prepare("PRAGMA journal_mode = WAL").get();
  return db;
}
