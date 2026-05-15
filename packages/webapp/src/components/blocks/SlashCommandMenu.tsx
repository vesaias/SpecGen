import { useEffect, useRef } from "react";
import type { BlockType } from "../../types";

interface BlockOption {
  type: BlockType;
  label: string;
  icon: string;
  /** Optional pre-populated Tiptap JSON for the new block. Currently used by
   * the "Collapsible" option to seed a richtext block with an empty details
   * node. */
  initialContent?: string;
}

// Empty details block: open, placeholder "Details" summary, empty paragraph body.
const DETAILS_TEMPLATE = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "details",
      attrs: { open: true },
      content: [
        { type: "detailsSummary", content: [{ type: "text", text: "Details" }] },
        { type: "detailsContent", content: [{ type: "paragraph" }] },
      ],
    },
  ],
});

const BLOCK_OPTIONS: BlockOption[] = [
  { type: "richtext", label: "Text", icon: "¶" },
  { type: "richtext", label: "Collapsible (details)", icon: "▸", initialContent: DETAILS_TEMPLATE },
  { type: "table", label: "Table", icon: "▦" },
  { type: "code", label: "Code Block", icon: "</>" },
  { type: "response", label: "Response Block", icon: "↩️" },
  { type: "callout", label: "Callout", icon: "💬" },
  { type: "image", label: "Image", icon: "🖼️" },
];

interface Props {
  position: { x: number; y: number };
  onSelect: (type: BlockType, initialContent?: string) => void;
  onClose: () => void;
}

export default function SlashCommandMenu({ position, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-xl shadow-xl w-[220px] py-1"
      style={{ left: position.x, top: position.y }}
    >
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500 font-semibold">
        Add block
      </div>
      {BLOCK_OPTIONS.map((b) => (
        <button
          type="button"
          key={b.label}
          onClick={() => {
            onSelect(b.type, b.initialContent);
            onClose();
          }}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-stone-700 dark:text-stone-300 hover:bg-stone-50 dark:hover:bg-stone-800 transition-colors"
        >
          <span className="w-5 text-center text-xs">{b.icon}</span>
          {b.label}
        </button>
      ))}
    </div>
  );
}
