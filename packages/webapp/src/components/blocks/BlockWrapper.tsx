import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";

interface Props {
  id: string;
  editable: boolean;
  indented?: boolean | "h3";
  onAddBlock: (e: React.MouseEvent) => void;
  onDeleteBlock?: () => void;
  children: ReactNode;
}

export default function BlockWrapper({
  id,
  editable,
  indented,
  onAddBlock,
  onDeleteBlock,
  children,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="group/block relative mb-3">
      {editable && (
        <div className="absolute -left-10 top-1/2 -translate-y-1/2 flex gap-0.5 opacity-0 group-hover/block:opacity-100 transition-opacity">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="w-6 h-6 flex items-center justify-center text-stone-300 dark:text-stone-600 hover:text-stone-500 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 rounded cursor-grab active:cursor-grabbing"
            title="Drag to reorder"
          >
            <span className="text-sm">{"\u283F"}</span>
          </button>
          <button
            type="button"
            onClick={(e) => onAddBlock(e)}
            className="w-6 h-6 flex items-center justify-center text-stone-300 dark:text-stone-600 hover:text-stone-500 dark:hover:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800 rounded"
            title="Add block below"
          >
            <span className="text-lg leading-none">+</span>
          </button>
          {onDeleteBlock && (
            <button
              type="button"
              onClick={onDeleteBlock}
              className="w-6 h-6 flex items-center justify-center text-stone-300 dark:text-stone-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 rounded"
              title="Delete block"
            >
              <span className="text-xs">✕</span>
            </button>
          )}
        </div>
      )}
      <div
        className={`${indented === true ? "pl-5" : ""} ${editable ? "pl-2 py-0.5 rounded hover:bg-stone-50/50 dark:hover:bg-stone-800/50 transition-colors" : ""}`}
      >
        {children}
      </div>
    </div>
  );
}
