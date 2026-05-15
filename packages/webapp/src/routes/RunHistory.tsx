import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { type RunRow, runsApi } from "../api/runsApi.js";
import { RunStatusBadge } from "../components/runs/RunStatusBadge.js";
import { AppShell } from "../components/ui/AppShell.js";

export function RunHistory() {
  const { slug } = useParams<{ slug: string }>();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    runsApi
      .list(slug)
      .then(setRuns)
      .catch((err) => setError((err as Error).message));
  }, [slug]);

  return (
    <AppShell
      maxWidth="screen-2xl"
      left={
        <>
          <Link
            to={`/projects/${slug}`}
            className="text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
          >
            ← {slug}
          </Link>
          <span className="text-stone-300 dark:text-stone-700">/</span>
          <span className="text-stone-700 dark:text-stone-300">Run history</span>
        </>
      }
    >
      {error && <div className="text-red-600 dark:text-red-400">Error: {error}</div>}
      <h1 className="text-2xl font-semibold mb-6 text-stone-900 dark:text-stone-100">
        Run history
      </h1>
      {runs.length === 0 ? (
        <div className="p-8 border border-dashed border-stone-300 dark:border-stone-700 rounded text-center text-stone-500 dark:text-stone-400">
          No runs yet. Trigger one with the "Run parse" button.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-stone-500 dark:text-stone-500 border-b border-stone-200 dark:border-stone-800">
              <tr>
                <th className="py-2 font-medium">Run</th>
                <th className="font-medium">Status</th>
                <th className="font-medium">Generator</th>
                <th className="font-medium">Profile</th>
                <th className="font-medium">Started</th>
                <th className="font-medium text-right">Duration</th>
                <th className="font-medium text-right">Items</th>
                <th className="font-medium text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-stone-100 dark:border-stone-800 hover:bg-stone-50 dark:hover:bg-stone-900"
                >
                  <td className="py-2">
                    <Link
                      to={`/runs/${r.id}`}
                      className="font-mono text-xs text-stone-700 dark:text-stone-300 hover:text-stone-900 dark:hover:text-stone-100"
                    >
                      {r.id.slice(0, 12)}…
                    </Link>
                  </td>
                  <td>
                    <RunStatusBadge status={r.status} />
                  </td>
                  <td className="text-xs">
                    {r.generator_name ? (
                      <>
                        <div className="text-stone-700 dark:text-stone-300">{r.generator_name}</div>
                        <div className="font-mono text-[10px] text-stone-400 dark:text-stone-600">
                          {r.generator_id}
                        </div>
                      </>
                    ) : (
                      <span className="font-mono text-stone-500 dark:text-stone-400">
                        {r.generator_id}
                      </span>
                    )}
                  </td>
                  <td className="font-mono text-xs text-stone-500 dark:text-stone-400">
                    {r.profile_id}
                  </td>
                  <td className="text-xs text-stone-500 dark:text-stone-400">
                    {r.started_at ? new Date(r.started_at).toLocaleString() : "—"}
                  </td>
                  <td className="text-xs text-stone-500 dark:text-stone-400 text-right">
                    {r.duration_ms !== null ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="text-xs text-right">
                    <span className="text-green-700 dark:text-green-400">
                      +{r.stats.itemsCreated}
                    </span>{" "}
                    <span className="text-stone-500 dark:text-stone-400">
                      ~{r.stats.itemsUpdated}
                    </span>
                  </td>
                  <td className="text-xs text-stone-500 dark:text-stone-400 text-right">
                    {r.stats.aiCostUsdTotal === 0 ? "—" : `$${r.stats.aiCostUsdTotal.toFixed(4)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
