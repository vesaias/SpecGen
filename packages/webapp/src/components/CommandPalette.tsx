import { Command } from "cmdk";
import { useEffect, useState } from "react";
import type { SearchResult } from "../hooks/useSearch";
import MethodBadge from "./MethodBadge";

interface Props {
  results: SearchResult[];
  onSelect: (id: string) => void;
}

export default function CommandPalette({ results, onSelect }: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  if (!open) return null;

  const backends = results.filter((r) => r.type === "backend");
  const frontends = results.filter((r) => r.type === "frontend");
  const events = results.filter((r) => r.type === "event");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={() => setOpen(false)}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      role="presentation"
    >
      <div className="fixed inset-0 bg-black/50" />
      <div
        className="relative bg-white dark:bg-stone-900 rounded-xl shadow-2xl w-[560px] max-h-[400px] overflow-hidden border border-stone-200 dark:border-stone-800"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
      >
        <Command label="Search specs">
          <Command.Input
            autoFocus
            placeholder="Search endpoints, pages, events..."
            className="w-full px-4 py-3 text-base bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 border-b border-stone-200 dark:border-stone-800 outline-none"
          />
          <Command.List className="max-h-[320px] overflow-y-auto p-2">
            <Command.Empty className="p-4 text-sm text-stone-400 dark:text-stone-600 text-center">
              No results found.
            </Command.Empty>

            {backends.length > 0 && (
              <Command.Group
                heading="Endpoints"
                className="text-xs uppercase text-stone-400 dark:text-stone-600 px-2 pt-2 pb-1"
              >
                {backends.map((r) => (
                  <Command.Item
                    key={r.id}
                    value={`${r.title} ${r.subtitle}`}
                    onSelect={() => {
                      onSelect(r.id);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-stone-700 dark:text-stone-300 rounded-lg cursor-pointer data-[selected=true]:bg-stone-100 dark:data-[selected=true]:bg-stone-800"
                  >
                    <MethodBadge method={r.title.split(" ")[0]} />
                    <span>{r.subtitle}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {frontends.length > 0 && (
              <Command.Group
                heading="Pages"
                className="text-xs uppercase text-stone-400 dark:text-stone-600 px-2 pt-2 pb-1"
              >
                {frontends.map((r) => (
                  <Command.Item
                    key={r.id}
                    value={`${r.title} ${r.subtitle}`}
                    onSelect={() => {
                      onSelect(r.id);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-stone-700 dark:text-stone-300 rounded-lg cursor-pointer data-[selected=true]:bg-stone-100 dark:data-[selected=true]:bg-stone-800"
                  >
                    <span>📄</span>
                    <span>{r.title}</span>
                    <span className="text-stone-400 dark:text-stone-600 text-xs ml-auto">
                      {r.subtitle}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {events.length > 0 && (
              <Command.Group
                heading="Events"
                className="text-xs uppercase text-stone-400 dark:text-stone-600 px-2 pt-2 pb-1"
              >
                {events.map((r) => (
                  <Command.Item
                    key={r.id}
                    value={`${r.title} ${r.subtitle}`}
                    onSelect={() => {
                      onSelect(r.id);
                      setOpen(false);
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-stone-700 dark:text-stone-300 rounded-lg cursor-pointer data-[selected=true]:bg-stone-100 dark:data-[selected=true]:bg-stone-800"
                  >
                    <span>⚡</span>
                    <span>{r.title.replace("Event", "")}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
