export type RunStatus = "queued" | "running" | "success" | "failed" | "cancelled" | "interrupted";

export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set([
  "success",
  "failed",
  "cancelled",
  "interrupted",
]);

export function isTerminalStatus(s: RunStatus): boolean {
  return TERMINAL_STATUSES.has(s);
}
