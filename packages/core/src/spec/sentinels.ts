/**
 * Marker strings used by parsers to indicate "human or AI should fill this in".
 * mergeSpec replaces these with parser output if available; otherwise leaves them.
 */
export const TODO_SENTINEL = "[TODO]";
export const TODO_HUMAN_SENTINEL = "[TODO: Human fills]";

export function isTodoSentinel(v: unknown): boolean {
  return v === TODO_SENTINEL || v === TODO_HUMAN_SENTINEL;
}
