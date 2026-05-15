import { useEffect, useState } from "react";

interface VersionEntry {
  version: number;
  at: string;
  by: string;
  changes: string;
}

interface Props {
  itemId: string;
  currentVersion: number;
  onClose: () => void;
  onRestore: (version: number) => void;
  onCompare: (version: number) => void;
  /** When provided, fetches from /api/projects/:slug/spec/item/:id/versions */
  projectSlug?: string;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 0 || Number.isNaN(diffMs)) return dateStr;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;

  return new Date(dateStr).toLocaleDateString();
}

const CloseIcon = () => (
  <svg
    aria-hidden="true"
    className="w-4 h-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const HistoryIcon = () => (
  <svg
    aria-hidden="true"
    className="w-4 h-4"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </svg>
);

export default function VersionHistory({
  itemId,
  currentVersion,
  onClose,
  onRestore,
  onCompare,
  projectSlug,
}: Props) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const url = projectSlug
      ? `/api/projects/${encodeURIComponent(projectSlug)}/spec/item/${encodeURIComponent(itemId)}/versions`
      : `/api/spec/item/${encodeURIComponent(itemId)}/versions`;

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load versions: ${res.statusText}`);
        return res.json();
      })
      .then((data) => {
        setVersions(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [itemId, projectSlug]);

  return (
    <div className="fixed top-0 right-0 bottom-0 w-[320px] bg-white dark:bg-stone-900 border-l border-stone-200 dark:border-stone-800 shadow-lg z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 dark:border-stone-800">
        <div className="flex items-center gap-2 text-sm font-semibold text-stone-800 dark:text-stone-100">
          <HistoryIcon />
          Version History
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 rounded transition-colors"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="px-4 py-8 text-center text-xs text-stone-400 dark:text-stone-600">
            Loading versions...
          </div>
        )}

        {error && (
          <div className="px-4 py-8 text-center text-xs text-red-500 dark:text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && versions.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-stone-400 dark:text-stone-600">
            No version history available.
          </div>
        )}

        {!loading && !error && versions.length > 0 && (
          <div className="py-2">
            {versions.map((entry) => {
              const isCurrent = entry.version === currentVersion;

              return (
                <div
                  key={entry.version}
                  className={`px-4 py-3 border-b border-stone-100 dark:border-stone-800 ${
                    isCurrent
                      ? "bg-stone-50 dark:bg-stone-800/40"
                      : "hover:bg-stone-50/60 dark:hover:bg-stone-800/30"
                  } transition-colors`}
                >
                  {/* Version number + badges */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-bold text-stone-800 dark:text-stone-100">
                      v{entry.version}
                    </span>
                    {isCurrent && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-brand-600 dark:bg-brand-500 text-white rounded">
                        current
                      </span>
                    )}
                    <span
                      className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                        entry.by === "cli"
                          ? "bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-300"
                          : "bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-300"
                      }`}
                    >
                      {entry.by}
                    </span>
                  </div>

                  {/* Timestamp */}
                  <div className="text-[11px] text-stone-400 dark:text-stone-600 mb-1">
                    {relativeTime(entry.at)}
                  </div>

                  {/* Change summary */}
                  {entry.changes && (
                    <div className="text-xs text-stone-600 dark:text-stone-400 mb-2 leading-relaxed">
                      {entry.changes}
                    </div>
                  )}

                  {/* Actions */}
                  {!isCurrent && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onCompare(entry.version)}
                        className="px-2 py-1 text-[11px] font-medium text-stone-500 dark:text-stone-300 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-md hover:border-stone-400 dark:hover:border-stone-500 transition-colors"
                      >
                        Compare
                      </button>
                      <button
                        type="button"
                        onClick={() => onRestore(entry.version)}
                        className="px-2 py-1 text-[11px] font-medium text-brand-700 dark:text-brand-300 bg-white dark:bg-stone-900 border border-brand-600/30 dark:border-brand-400/30 rounded-md hover:bg-brand-600 dark:hover:bg-brand-500 hover:text-white dark:hover:text-white transition-colors"
                      >
                        Restore
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
