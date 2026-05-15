import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useState } from "react";
import { runsApi } from "../api/runsApi.js";
import type { SpecJson, TreeNode as TreeNodeType } from "../types";
import TreeNode from "./TreeNode";
import { ProgressDrawer } from "./runs/ProgressDrawer.js";
import { Button } from "./ui/Button.js";

interface Props {
  spec: SpecJson;
  activeId: string | null;
  onSelect: (id: string) => void;
  onUpdateTree: (tree: TreeNodeType[]) => void;
  /** Project slug — required to dispatch a smart-tree run */
  projectSlug: string;
}

interface ContextMenu {
  x: number;
  y: number;
  nodeId: string;
  nodeType: string;
}

function collectLeafIds(nodes: TreeNodeType[]): string[] {
  const ids: string[] = [];
  for (const n of nodes) {
    if (n.type === "folder") {
      if (n.children) ids.push(...collectLeafIds(n.children));
    } else {
      ids.push(n.id);
    }
  }
  return ids;
}

function removeFromTree(
  tree: TreeNodeType[],
  itemId: string,
): [TreeNodeType[], TreeNodeType | null] {
  let removed: TreeNodeType | null = null;
  const newTree = tree.map((node) => {
    if (node.type === "folder" && node.children) {
      const childIdx = node.children.findIndex((c) => c.id === itemId);
      if (childIdx >= 0) {
        removed = node.children[childIdx];
        return {
          ...node,
          children: [...node.children.slice(0, childIdx), ...node.children.slice(childIdx + 1)],
        };
      }
      const [newChildren, found] = removeFromTree(node.children, itemId);
      if (found) removed = found;
      return { ...node, children: newChildren };
    }
    return node;
  });
  return [newTree, removed];
}

function insertIntoFolder(
  tree: TreeNodeType[],
  folderId: string,
  item: TreeNodeType,
): TreeNodeType[] {
  return tree.map((node) => {
    if (node.id === folderId && node.type === "folder") {
      return { ...node, children: [...(node.children || []), item] };
    }
    if (node.type === "folder" && node.children) {
      return { ...node, children: insertIntoFolder(node.children, folderId, item) };
    }
    return node;
  });
}

function findParentFolder(tree: TreeNodeType[], itemId: string): string | null {
  for (const node of tree) {
    if (node.type === "folder" && node.children) {
      if (node.children.some((c) => c.id === itemId)) return node.id;
      const found = findParentFolder(node.children, itemId);
      if (found) return found;
    }
  }
  return null;
}

const SearchIcon = () => (
  <svg
    aria-hidden="true"
    className="w-3.5 h-3.5 text-stone-400 dark:text-stone-500"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

const PlusIcon = () => (
  <svg
    aria-hidden="true"
    className="w-3.5 h-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </svg>
);

export default function Sidebar({ spec, activeId, onSelect, onUpdateTree, projectSlug }: Props) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [filter, setFilter] = useState("");
  const [reorganizeConfirm, setReorganizeConfirm] = useState(false);
  const [reorganizeBusy, setReorganizeBusy] = useState(false);
  const [reorganizeError, setReorganizeError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const itemCount = Object.keys(spec.items).length;

  async function handleReorganize() {
    setReorganizeConfirm(false);
    setReorganizeBusy(true);
    setReorganizeError(null);
    try {
      const { runId } = await runsApi.enqueue(projectSlug, {
        generator: "smart-tree",
        profile: "pm-spec",
      });
      setActiveRunId(runId);
    } catch (err) {
      setReorganizeError((err as Error).message);
    } finally {
      setReorganizeBusy(false);
    }
  }
  const allIds = collectLeafIds(spec.tree);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragStart(event: DragStartEvent) {
    setDraggedId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggedId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeItemId = active.id as string;
    const overId = over.id as string;
    const overFolder =
      findParentFolder(spec.tree, overId) ||
      (spec.tree.find((n) => n.id === overId && n.type === "folder") ? overId : null);
    if (!overFolder) return;
    let [newTree, removed] = removeFromTree(JSON.parse(JSON.stringify(spec.tree)), activeItemId);
    if (!removed) return;
    newTree = insertIntoFolder(newTree, overFolder, removed);
    onUpdateTree(newTree);
  }

  function handleContextMenu(e: React.MouseEvent, nodeId: string, nodeType: string) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId, nodeType });
  }

  function handleRenameFolder() {
    if (!contextMenu) return;
    const name = prompt("Rename folder:");
    if (!name) {
      setContextMenu(null);
      return;
    }
    const newTree = spec.tree.map(function renameInTree(n: TreeNodeType): TreeNodeType {
      if (n.id === contextMenu.nodeId) return { ...n, label: name };
      if (n.type === "folder" && n.children)
        return { ...n, children: n.children.map(renameInTree) };
      return n;
    });
    onUpdateTree(newTree);
    setContextMenu(null);
  }

  function handleCreateFolder() {
    const name = prompt("New folder name:");
    if (!name) {
      setContextMenu(null);
      return;
    }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const newTree = [...spec.tree, { id, type: "folder" as const, label: name, children: [] }];
    onUpdateTree(newTree);
    setContextMenu(null);
  }

  function handleDeleteFolder() {
    if (!contextMenu) return;
    const newTree = spec.tree.filter((n) => n.id !== contextMenu.nodeId);
    onUpdateTree(newTree);
    setContextMenu(null);
  }

  return (
    <nav
      data-print-hide
      className="w-[280px] bg-stone-50/80 dark:bg-stone-900/80 border-r border-stone-200 dark:border-stone-800 fixed top-14 left-0 bottom-0 flex flex-col"
      onClick={() => setContextMenu(null)}
      onKeyDown={(e) => e.key === "Escape" && setContextMenu(null)}
    >
      {/* Search + add actions */}
      <div className="px-3 pt-3 pb-2 flex items-center gap-1.5">
        <div className="relative flex-1">
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2">
            <SearchIcon />
          </div>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search..."
            className="w-full bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-md pl-8 pr-3 py-1.5 text-xs text-stone-700 dark:text-stone-300 outline-none focus:border-brand-400 dark:focus:border-brand-400 placeholder:text-stone-400 dark:placeholder:text-stone-600 transition-colors"
          />
        </div>
        <button
          type="button"
          onClick={handleCreateFolder}
          className="w-7 h-7 flex items-center justify-center text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 hover:bg-stone-200/60 dark:hover:bg-stone-800 rounded-md transition-colors flex-shrink-0"
          title="Add folder"
        >
          <PlusIcon />
        </button>
        {itemCount >= 5 && (
          <button
            type="button"
            onClick={() => setReorganizeConfirm(true)}
            disabled={reorganizeBusy}
            className="w-7 h-7 flex items-center justify-center text-stone-400 dark:text-stone-500 hover:text-brand-600 dark:hover:text-brand-300 hover:bg-stone-200/60 dark:hover:bg-stone-800 rounded-md transition-colors flex-shrink-0 text-xs"
            title="Reorganize with AI"
          >
            ✨
          </button>
        )}
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={allIds} strategy={verticalListSortingStrategy}>
            {spec.tree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                items={spec.items}
                activeId={activeId}
                onSelect={onSelect}
                onContextMenu={handleContextMenu}
                filter={filter || undefined}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white dark:bg-stone-900 border border-stone-200 dark:border-stone-700 rounded-lg shadow-lg py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.nodeType === "folder" && (
            <>
              <button
                type="button"
                onClick={handleRenameFolder}
                className="w-full text-left px-3 py-1.5 text-sm text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
              >
                Rename folder
              </button>
              <button
                type="button"
                onClick={handleDeleteFolder}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-stone-100 dark:hover:bg-stone-800 text-red-600 dark:text-red-400"
              >
                Delete folder
              </button>
              <div className="border-t border-stone-100 dark:border-stone-800 my-1" />
            </>
          )}
          <button
            type="button"
            onClick={handleCreateFolder}
            className="w-full text-left px-3 py-1.5 text-sm text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
          >
            New folder
          </button>
        </div>
      )}

      {/* Reorganize confirmation modal */}
      {reorganizeConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/60"
          onClick={() => setReorganizeConfirm(false)}
          onKeyDown={(e) => e.key === "Escape" && setReorganizeConfirm(false)}
        >
          <div
            className="bg-white dark:bg-stone-900 rounded-lg shadow-xl border border-stone-200 dark:border-stone-700 p-5 max-w-xs w-full mx-4"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-semibold text-stone-800 dark:text-stone-100 mb-2">
              Reorganize with AI?
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-400 mb-4">
              This will reorder the sidebar tree using AI, grouping items by business domain. Items
              themselves are not deleted or changed.
            </p>
            {reorganizeError && (
              <p className="text-xs text-red-600 dark:text-red-400 mb-3">{reorganizeError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setReorganizeConfirm(false)}>
                Cancel
              </Button>
              <Button variant="brand" onClick={handleReorganize}>
                Reorganize
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Progress drawer for the smart-tree run */}
      <ProgressDrawer runId={activeRunId} onClose={() => setActiveRunId(null)} />
    </nav>
  );
}
