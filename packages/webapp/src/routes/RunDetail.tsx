import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type RunEvent, type RunRow, runsApi } from "../api/runsApi.js";
import { RunEventList } from "../components/runs/RunEventList.js";
import { RunStatusBadge } from "../components/runs/RunStatusBadge.js";
import { AppShell } from "../components/ui/AppShell.js";

export function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<RunRow | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Initial fetch + start subscribing
  useEffect(() => {
    if (!id) return;
    runsApi
      .get(id)
      .then(setRun)
      .catch((err) => setError((err as Error).message));
    return runsApi.subscribe(id, (event) => setEvents((prev) => [...prev, event]));
  }, [id]);

  // After 'done' or 'error' event, refresh the run record so stats reflect persisted values
  useEffect(() => {
    if (!id || events.length === 0) return;
    const last = events[events.length - 1];
    if (last.type === "done" || last.type === "error") {
      runsApi
        .get(id)
        .then(setRun)
        .catch(() => undefined);
    }
  }, [id, events]);

  if (error)
    return (
      <AppShell maxWidth="screen-xl">
        <div className="text-red-600 dark:text-red-400">Error: {error}</div>
      </AppShell>
    );
  if (!run)
    return (
      <AppShell maxWidth="screen-xl">
        <div className="text-stone-500 dark:text-stone-400">Loading…</div>
      </AppShell>
    );

  return (
    <AppShell
      maxWidth="screen-xl"
      left={
        <Link
          to="/"
          className="text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
        >
          ← Dashboard
        </Link>
      }
    >
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">Run</h1>
          <RunStatusBadge status={run.status} />
        </div>
        <div className="text-xs font-mono text-stone-500 dark:text-stone-400 break-all">
          {run.id}
        </div>
        <div className="text-sm text-stone-500 dark:text-stone-400 mt-1">
          generator:{" "}
          {run.generator_name ? (
            <>
              {run.generator_name}{" "}
              <code className="font-mono text-xs text-stone-400 dark:text-stone-600">
                ({run.generator_id})
              </code>
            </>
          ) : (
            <code className="font-mono">{run.generator_id}</code>
          )}
          {" · "}profile: <code className="font-mono">{run.profile_id}</code>
        </div>
      </header>

      {run.error_text && (
        <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 rounded p-3 mb-4 text-sm text-red-800 dark:text-red-300">
          <strong>Error:</strong> {run.error_text}
        </div>
      )}

      {run.status !== "queued" && run.status !== "running" && (
        <section className="border border-stone-200 dark:border-stone-800 rounded p-4 mb-6 bg-white dark:bg-stone-900">
          <h2 className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-500 mb-3">
            Final stats
          </h2>
          <div className="grid grid-cols-4 gap-4 text-sm">
            <Stat label="Created" value={`+${run.stats.itemsCreated}`} />
            <Stat label="Updated" value={`~${run.stats.itemsUpdated}`} />
            <Stat label="Removed" value={`-${run.stats.itemsRemoved}`} />
            <Stat label="Warnings" value={String(run.stats.warnings)} />
            <Stat label="AI calls" value={String(run.stats.aiCalls.length)} />
            <Stat
              label="Cost"
              value={
                run.stats.aiCostUsdTotal === 0
                  ? "free / subscription"
                  : `$${run.stats.aiCostUsdTotal.toFixed(4)}`
              }
            />
            <Stat
              label="Duration"
              value={run.duration_ms !== null ? `${(run.duration_ms / 1000).toFixed(1)}s` : "—"}
            />
            <Stat
              label="Started"
              value={run.started_at ? new Date(run.started_at).toLocaleString() : "—"}
            />
          </div>
        </section>
      )}

      <section>
        <h2 className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-500 mb-3">
          Event log
        </h2>
        {events.length === 0 ? (
          <div className="text-sm text-stone-500 dark:text-stone-400">No events.</div>
        ) : (
          <RunEventList events={events} />
        )}
      </section>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-stone-500 dark:text-stone-500 uppercase text-[10px] tracking-wide">
        {label}
      </div>
      <div className="font-mono text-sm text-stone-900 dark:text-stone-100">{value}</div>
    </div>
  );
}
