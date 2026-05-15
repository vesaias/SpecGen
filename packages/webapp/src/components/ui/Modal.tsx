import { useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** "lg" defaults to max-w-3xl; "xl" is wider for side-by-side content */
  size?: "lg" | "xl";
}

export function Modal({ open, onClose, title, children, size = "lg" }: Props) {
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const sizeClass = size === "xl" ? "max-w-5xl" : "max-w-3xl";

  return (
    <dialog
      open
      className="fixed inset-0 z-50 flex items-center justify-center w-full h-full max-w-none max-h-none m-0 bg-transparent p-0"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      aria-modal="true"
    >
      <div className="fixed inset-0 bg-stone-900/50 dark:bg-black/70 -z-10" aria-hidden="true" />
      <div
        className={`bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded-lg shadow-xl border border-stone-200 dark:border-stone-800 w-full ${sizeClass} max-h-[90vh] overflow-hidden flex flex-col`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {title && (
          <header className="px-5 py-3 border-b border-stone-200 dark:border-stone-800 flex items-center justify-between">
            <h2 className="text-base font-medium text-stone-900 dark:text-stone-100">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
              aria-label="Close"
            >
              ✕
            </button>
          </header>
        )}
        <div className="overflow-y-auto p-5 flex-1">{children}</div>
      </div>
    </dialog>
  );
}
