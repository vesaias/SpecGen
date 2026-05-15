import { useEffect, useState } from "react";
import { type RunEvent, runsApi } from "../../api/runsApi.js";
import { RunEventList } from "./RunEventList.js";
import { RunStatusBadge } from "./RunStatusBadge.js";

interface Props {
  runId: string | null;
  onClose: () => void;
}

export function ProgressDrawer({ runId, onClose }: Props) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [status, setStatus] = useState<string>("queued");

  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    setStatus("queued");
    const cleanup = runsApi.subscribe(runId, (event) => {
      setEvents((prev) => [...prev, event]);
      if (event.type === "done") setStatus("success");
      else if (event.type === "error") setStatus("failed");
      else if (event.type === "progress" || event.type === "item-updated") setStatus("running");
      // warnings keep the current status unchanged
    });
    return cleanup;
  }, [runId]);

  if (!runId) return null;

  return (
    <div className="fixed top-0 right-0 h-full w-[480px] bg-white dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 shadow-lg z-40 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-stone-200 dark:border-stone-800">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-stone-900 dark:text-stone-100">Run</span>
          <code className="text-xs font-mono text-stone-500 dark:text-stone-400">
            {runId.slice(0, 12)}…
          </code>
          <RunStatusBadge status={status} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
        >
          ✕
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {events.length === 0 ? (
          <div className="text-sm text-stone-500 dark:text-stone-400">Waiting for first event…</div>
        ) : (
          <RunEventList events={events} />
        )}
      </div>
    </div>
  );
}
