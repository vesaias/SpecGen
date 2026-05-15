import { existsSync, unlinkSync } from "node:fs";
import { type RunStatus, type RunSummary, emptyRunSummary } from "@specgen/core";
import type { Db } from "../db/sqlite.js";
import { ulid } from "../services/ulid.js";

export interface RunRow {
  id: string;
  project_id: string;
  generator_id: string;
  profile_id: string;
  status: RunStatus;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  stats: RunSummary;
  error_text: string | null;
  log_path: string | null;
  created_at: string;
}

export interface CreateRunInput {
  projectId: string;
  generatorId: string;
  profileId: string;
}

export interface UpdateStatusOptions {
  startedAt?: string;
  finishedAt?: string;
  errorText?: string;
  logPath?: string;
}

interface RawRunRow {
  id: string;
  project_id: string;
  generator_id: string;
  profile_id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  stats_json: string;
  error_text: string | null;
  log_path: string | null;
  created_at: string;
}

function rowToRun(raw: RawRunRow): RunRow {
  let stats: RunSummary;
  try {
    stats = JSON.parse(raw.stats_json) as RunSummary;
  } catch {
    stats = emptyRunSummary();
  }
  return {
    id: raw.id,
    project_id: raw.project_id,
    generator_id: raw.generator_id,
    profile_id: raw.profile_id,
    status: raw.status as RunStatus,
    started_at: raw.started_at,
    finished_at: raw.finished_at,
    duration_ms: raw.duration_ms,
    stats,
    error_text: raw.error_text,
    log_path: raw.log_path,
    created_at: raw.created_at,
  };
}

export class SqliteRunRepository {
  constructor(private readonly db: Db) {}

  create(input: CreateRunInput): RunRow {
    const id = ulid();
    const stats = JSON.stringify(emptyRunSummary());
    this.db
      .prepare(
        `INSERT INTO runs (id, project_id, generator_id, profile_id, status, stats_json)
         VALUES (?, ?, ?, ?, 'queued', ?)`,
      )
      .run(id, input.projectId, input.generatorId, input.profileId, stats);
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as unknown as RawRunRow;
    return rowToRun(row);
  }

  findById(id: string): RunRow | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as unknown as
      | RawRunRow
      | undefined;
    return row ? rowToRun(row) : null;
  }

  listByProjectId(projectId: string): RunRow[] {
    const rows = this.db
      .prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC, id DESC")
      .all(projectId) as unknown as RawRunRow[];
    return rows.map(rowToRun);
  }

  updateStatus(id: string, status: RunStatus, opts: UpdateStatusOptions = {}): void {
    // Read current row to compute duration if both timestamps will be set
    const current = this.findById(id);
    if (!current) return;

    const startedAt = opts.startedAt ?? current.started_at;
    const finishedAt = opts.finishedAt ?? current.finished_at;
    let durationMs: number | null = current.duration_ms;
    if (startedAt && finishedAt && opts.finishedAt) {
      durationMs = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
    }

    this.db
      .prepare(
        `UPDATE runs SET
            status = ?,
            started_at = ?,
            finished_at = ?,
            duration_ms = ?,
            error_text = COALESCE(?, error_text),
            log_path = COALESCE(?, log_path)
          WHERE id = ?`,
      )
      .run(
        status,
        startedAt,
        finishedAt,
        durationMs,
        opts.errorText ?? null,
        opts.logPath ?? null,
        id,
      );
  }

  updateStats(id: string, stats: RunSummary): void {
    this.db.prepare("UPDATE runs SET stats_json = ? WHERE id = ?").run(JSON.stringify(stats), id);
  }

  delete(id: string): void {
    const row = this.findById(id);
    if (row?.log_path && existsSync(row.log_path)) {
      try {
        unlinkSync(row.log_path);
      } catch {
        // tolerate unlink failure (already gone, permission, etc.)
      }
    }
    this.db.prepare("DELETE FROM runs WHERE id = ?").run(id);
  }

  /**
   * Called once at server boot. Any run still in 'queued' or 'running' state
   * is from a crashed previous process — mark them 'interrupted' with finished_at = now.
   * Returns the number of rows updated.
   */
  markInterruptedOnBoot(): number {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE runs SET status = 'interrupted', finished_at = ?
         WHERE status IN ('queued', 'running')`,
      )
      .run(now);
    return Number(result.changes ?? 0);
  }
}
