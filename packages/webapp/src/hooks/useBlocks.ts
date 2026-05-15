import { useCallback, useEffect, useRef, useState } from "react";
import type { Block, BlockType, SpecItem } from "../types";

export function useBlocks(
  item: SpecItem,
  editable: boolean,
  buildDefaults: () => Block[],
  onUpdate: (updates: Partial<SpecItem>) => void,
) {
  const initializedFor = useRef<string>("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const blocksRef = useRef<Block[]>(blocks);
  const wasEditing = useRef(false);

  // Initialize blocks once per item (by title)
  if (initializedFor.current !== item.title) {
    initializedFor.current = item.title;
    const init = item.blocks || buildDefaults();
    setBlocks(init);
    blocksRef.current = init;
  }

  // When leaving edit mode, flush ref content to state so view mode renders latest
  useEffect(() => {
    if (wasEditing.current && !editable) {
      setBlocks([...blocksRef.current]);
    }
    wasEditing.current = editable;
  }, [editable]);

  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  // Content-only updates: update ref + debounced API save, NO re-render
  const updateBlockContent = useCallback(
    (blockId: string, updates: Partial<Block>) => {
      blocksRef.current = blocksRef.current.map((b) =>
        b.id === blockId ? { ...b, ...updates } : b,
      );
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        onUpdate({ blocks: blocksRef.current } as Partial<SpecItem>);
      }, 1000);
    },
    [onUpdate],
  );

  // Structural changes: update state + ref + immediate API save
  const insertBlock = useCallback(
    (afterBlockId: string, type: BlockType, initialContent?: string) => {
      const newBlock: Block = { id: `b-${Date.now()}`, type };
      if (type === "richtext" || type === "code" || type === "callout")
        newBlock.content = initialContent ?? "";
      if (type === "table")
        newBlock.table = { columns: ["Column 1", "Column 2"], rows: [["", ""]] };
      if (type === "response") newBlock.responses = [{ status: 200, description: "", body: "" }];
      const idx = blocksRef.current.findIndex((b) => b.id === afterBlockId);
      const newBlocks = [...blocksRef.current];
      newBlocks.splice(idx + 1, 0, newBlock);
      setBlocks(newBlocks);
      blocksRef.current = newBlocks;
      onUpdate({ blocks: newBlocks } as Partial<SpecItem>);
    },
    [onUpdate],
  );

  const reorderBlocks = useCallback(
    (activeId: string, overId: string) => {
      const oldIdx = blocksRef.current.findIndex((b) => b.id === activeId);
      const newIdx = blocksRef.current.findIndex((b) => b.id === overId);
      if (oldIdx < 0 || newIdx < 0) return;
      const newBlocks = [...blocksRef.current];
      const [moved] = newBlocks.splice(oldIdx, 1);
      newBlocks.splice(newIdx, 0, moved);
      setBlocks(newBlocks);
      blocksRef.current = newBlocks;
      onUpdate({ blocks: newBlocks } as Partial<SpecItem>);
    },
    [onUpdate],
  );

  const deleteBlock = useCallback(
    (blockId: string) => {
      const newBlocks = blocksRef.current.filter((b) => b.id !== blockId);
      setBlocks(newBlocks);
      blocksRef.current = newBlocks;
      onUpdate({ blocks: newBlocks } as Partial<SpecItem>);
    },
    [onUpdate],
  );

  return { blocks, updateBlockContent, insertBlock, deleteBlock, reorderBlocks };
}
