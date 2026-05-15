import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useState } from "react";
import type { SpecItem, TreeNode as TreeNodeType } from "../types";
import MethodBadge from "./MethodBadge";

interface Props {
  node: TreeNodeType;
  items: Record<string, SpecItem>;
  activeId: string | null;
  onSelect: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, nodeId: string, nodeType: string) => void;
  depth?: number;
  filter?: string;
}

// SVG icons
const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    aria-hidden="true"
    className={`w-3.5 h-3.5 text-stone-400 dark:text-stone-500 transition-transform flex-shrink-0 ${open ? "rotate-90" : ""}`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const DocIcon = () => (
  <svg
    aria-hidden="true"
    className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500 flex-shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const EventIcon = () => (
  <svg
    aria-hidden="true"
    className="w-3.5 h-3.5 text-amber-500 flex-shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

export default function TreeNode({
  node,
  items,
  activeId,
  onSelect,
  onContextMenu,
  depth = 0,
  filter,
}: Props) {
  const storageKey = `sg_tree_${node.id}`;
  const [open, setOpen] = useState(() => {
    const saved = localStorage.getItem(storageKey);
    return saved !== null ? saved === "open" : true;
  });

  useEffect(() => {
    localStorage.setItem(storageKey, open ? "open" : "closed");
  }, [open, storageKey]);

  // Force open when filtering
  const isFiltering = !!filter;

  if (node.type === "folder") {
    // When filtering, check if any children match
    const visibleChildren =
      node.children?.filter((child) => {
        if (!filter) return true;
        if (child.type === "folder") return true; // recurse will handle
        const item = items[child.id];
        if (!item) return false;
        const route = item.type === "backend" ? item.route : "";
        const method = item.type === "backend" ? item.method : "";
        const searchText = `${item.title} ${route} ${method}`.toLowerCase();
        return searchText.includes(filter.toLowerCase());
      }) || [];

    if (isFiltering && visibleChildren.length === 0) return null;
    const childCount = node.children?.length || 0;
    const isOpen = isFiltering || open;

    return (
      <div onContextMenu={(e) => onContextMenu(e, node.id, "folder")}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[12px] font-semibold text-stone-500 dark:text-stone-400 hover:bg-stone-100/80 dark:hover:bg-stone-800/80 rounded-md transition-colors"
          style={{ paddingLeft: depth > 0 ? 12 + depth * 12 : 8 }}
        >
          <ChevronIcon open={isOpen} />
          <span className="truncate">{node.label}</span>
          <span className="ml-auto bg-stone-200/60 dark:bg-stone-800 text-stone-400 dark:text-stone-500 text-[10px] font-medium px-1.5 py-0.5 rounded-full">
            {childCount}
          </span>
        </button>
        {isOpen && (
          <div className="relative">
            {depth > 0 && (
              <div className="absolute left-[18px] top-0 bottom-0 w-px bg-stone-200 dark:bg-stone-800" />
            )}
            {(isFiltering ? visibleChildren : node.children)?.map((child) => (
              <TreeNode
                key={child.id}
                node={child}
                items={items}
                activeId={activeId}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                depth={depth + 1}
                filter={filter}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const item = items[node.id];
  if (!item) return null;

  // Filter check for leaf items
  if (filter) {
    const route = item.type === "backend" ? item.route : "";
    const method = item.type === "backend" ? item.method : "";
    const searchText = `${item.title} ${route} ${method}`.toLowerCase();
    if (!searchText.includes(filter.toLowerCase())) return null;
  }

  const isActive = activeId === node.id;
  const label =
    item.type === "backend"
      ? item.route
          .replace(/^\/api\//i, "/")
          .replace(/:\w+/g, "")
          .toLowerCase()
      : item.title;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: node.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={() => onSelect(node.id)}
      onContextMenu={(e) => onContextMenu(e, node.id, node.type)}
      className={`w-full flex items-center gap-1.5 py-1 px-2 text-[12px] rounded-md transition-colors
        ${
          isActive
            ? "bg-brand-600/10 dark:bg-brand-400/15 text-brand-700 dark:text-brand-300 font-medium"
            : "text-stone-600 dark:text-stone-400 hover:bg-stone-100/80 dark:hover:bg-stone-800/80"
        }`}
      style={{ ...style, paddingLeft: 8 + depth * 12 }}
    >
      {item.type === "backend" && <MethodBadge method={item.method} />}
      {item.type === "frontend" && <DocIcon />}
      {(item.type === "event" || item.type === "handler") && <EventIcon />}
      {item.type === "handler" && <span className="text-[10px]">&#9881;</span>}
      <span className="truncate" title={label}>
        {label}
      </span>
    </button>
  );
}
