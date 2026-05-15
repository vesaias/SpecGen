const COLORS: Record<string, string> = {
  queued: "bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300",
  running: "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300",
  success: "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300",
  failed: "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300",
  cancelled: "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300",
  interrupted: "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300",
};

export function RunStatusBadge({ status }: { status: string }) {
  const cls = COLORS[status] ?? "bg-stone-100 dark:bg-stone-800 text-stone-500 dark:text-stone-400";
  return <span className={`text-xs px-2 py-0.5 rounded font-medium ${cls}`}>{status}</span>;
}
