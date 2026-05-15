import type { Spec, SpecItem } from "./types.js";

/**
 * SpecRepository — abstraction over spec storage.
 *
 * Implementations:
 * - JsonSpecRepository  — filesystem JSON files (OSS default)
 * - (future) SqliteSpecRepository — embedded SQLite via node:sqlite
 *
 * Contract:
 * - All methods are async so implementations can do I/O without blocking.
 * - `read()` returns null if no spec has been written yet (fresh project).
 * - Item ids MUST match `[a-z0-9][a-z0-9-]*` — implementations enforce this.
 * - Implementations MUST be atomic for write operations (temp + rename).
 */

/** Consistent view of the entire spec for exporters. */
export interface SpecSnapshot {
  spec: Spec;
  items: Record<string, SpecItem>;
}

export interface SpecRepository {
  /** Returns the full spec (meta + tree + item stubs), or null if not yet written. */
  read(): Promise<Spec | null>;

  /** Atomically writes the full spec document. */
  write(spec: Spec): Promise<void>;

  /** Returns a single item by id, or null if not found. */
  readItem(id: string): Promise<SpecItem | null>;

  /** Atomically writes a single item (creates or replaces). */
  writeItem(item: SpecItem): Promise<void>;

  /** Deletes a single item. No-op if not found. */
  deleteItem(id: string): Promise<void>;

  /** Returns sorted list of all item ids present in the store. */
  listItemIds(): Promise<string[]>;

  /**
   * Atomic-ish read of the entire spec for exporters. Tolerates items
   * that vanish between listItemIds() and readItem() (a concurrent run dropped
   * them). Throws if the root spec.json is missing.
   */
  snapshot(): Promise<SpecSnapshot>;
}
