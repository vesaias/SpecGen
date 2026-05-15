import { useEffect, useRef, useState } from "react";
import { Button } from "./ui/Button.js";

interface Props {
  slug: string;
  /** When provided, show "Markdown (this item)" in addition to the zip option. */
  itemId?: string;
}

/**
 * ExportMenu — dropdown for exporting spec items or the full project.
 *
 * Renders as a "Export ▾" button that opens a small dropdown with:
 *   - "Markdown (this item)"  — only when itemId is set
 *   - "Markdown zip (all items)" — always
 */
export function ExportMenu({ slug, itemId }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Export ▾
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-56 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-md shadow-lg z-10"
        >
          {itemId && (
            <a
              role="menuitem"
              href={`/api/v0/projects/${slug}/spec/item/${itemId}/export.md`}
              download
              className="block px-3 py-2 text-sm text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800"
              onClick={() => setOpen(false)}
            >
              Markdown (this item)
            </a>
          )}
          <a
            role="menuitem"
            href={`/api/v0/projects/${slug}/export.zip`}
            download
            className="block px-3 py-2 text-sm text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800"
            onClick={() => setOpen(false)}
          >
            Markdown zip (all items)
          </a>
          {itemId && (
            <a
              role="menuitem"
              href={`/api/v0/projects/${slug}/spec/item/${itemId}/export.pdf`}
              download
              className="block px-3 py-2 text-sm text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800"
              onClick={() => setOpen(false)}
            >
              PDF (this item)
            </a>
          )}
        </div>
      )}
    </div>
  );
}
