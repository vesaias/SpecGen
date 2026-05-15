/**
 * Map well-known sentinel item ids to user-friendly labels.
 *
 * Generators (project-bootstrap, smart-tree, etc.) emit `item-updated`
 * events with sentinel ids like `__meta__` and `__tree__` to signal that
 * something other than a normal SpecItem was written. These ids are
 * useful for debugging but unhelpful in the run log UI, so the webapp
 * substitutes a friendlier label and keeps the raw id available as a
 * mono-font appendage (see `sentinelLabelWithId`).
 *
 * Add to SENTINELS whenever a new generator introduces a sentinel id.
 * Source: `packages/core/src/generator/builtins/*.ts` — grep for
 * `itemId: "__\w+__"`.
 */
const SENTINELS: Record<string, string> = {
  __meta__: "Project metadata",
  __tree__: "Sidebar tree",
  __bootstrap__: "Project overview",
  __captures__: "Captures summary",
};

/**
 * Return a friendly label for known sentinel item ids, or the raw id
 * otherwise. Stable across calls; safe to use in render paths.
 */
export function sentinelLabel(id: string): string {
  return SENTINELS[id] ?? id;
}

/**
 * Return `<label> (<id>)` for known sentinels so the raw id stays
 * discoverable in the UI without dominating the line. For non-sentinel
 * ids, return the id verbatim (no parentheses).
 */
export function sentinelLabelWithId(id: string): string {
  const label = SENTINELS[id];
  return label ? `${label} (${id})` : id;
}

/** True when the given item id is a well-known sentinel. */
export function isSentinel(id: string): boolean {
  return id in SENTINELS;
}
