import type { ReactNode } from "react";
import type { RunEvent } from "../../api/runsApi.js";
import { isSentinel, sentinelLabel } from "../../utils/sentinelLabel.js";

const ICON: Record<string, string> = {
  progress: "→",
  "item-updated": "✓",
  warning: "⚠",
  error: "✗",
  done: "🎉",
};

function renderLine(e: RunEvent): ReactNode {
  if (e.type === "progress")
    return <span className="text-stone-700 dark:text-stone-300">{e.message}</span>;
  if (e.type === "item-updated") {
    if (isSentinel(e.itemId)) {
      return (
        <span className="text-stone-700 dark:text-stone-300">
          {sentinelLabel(e.itemId)}{" "}
          <span className="text-stone-400 dark:text-stone-600">({e.itemId})</span>
        </span>
      );
    }
    return <span className="text-stone-700 dark:text-stone-300">{e.itemId}</span>;
  }
  if (e.type === "warning")
    return <span className="text-amber-700 dark:text-amber-300">{e.message}</span>;
  if (e.type === "error")
    return <span className="text-red-600 dark:text-red-400">{e.error.message ?? "error"}</span>;
  if (e.type === "done") {
    const s = e.stats;
    return (
      <span>
        <span className="text-green-700 dark:text-green-400">+{s.itemsCreated}</span>{" "}
        <span className="text-stone-500 dark:text-stone-400">~{s.itemsUpdated}</span>{" "}
        {s.warnings > 0 ? (
          <span className="text-amber-700 dark:text-amber-300">{s.warnings}w</span>
        ) : null}{" "}
        <span className="text-stone-500 dark:text-stone-400">${s.aiCostUsdTotal.toFixed(4)}</span>
      </span>
    );
  }
  return JSON.stringify(e);
}

export function RunEventList({ events }: { events: RunEvent[] }) {
  return (
    <ol className="space-y-1 text-xs font-mono">
      {events.map((e, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-stone-400 dark:text-stone-600 w-4 text-center">
            {ICON[e.type] ?? "·"}
          </span>
          <span className="flex-1">{renderLine(e)}</span>
        </li>
      ))}
    </ol>
  );
}
