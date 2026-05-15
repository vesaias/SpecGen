import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useMemo, useState } from "react";
import type { Block, BlockType, SpecItem } from "../../types";
import BlockRenderer from "./BlockRenderer";
import BlockWrapper from "./BlockWrapper";
import SlashCommandMenu from "./SlashCommandMenu";

interface Props {
  blocks: Block[];
  item: SpecItem;
  editable: boolean;
  onInsertBlock: (afterId: string, type: BlockType, initialContent?: string) => void;
  onUpdateBlock: (id: string, updates: Partial<Block>) => void;
  onDeleteBlock: (id: string) => void;
  onReorder: (activeId: string, overId: string) => void;
}

type TiptapNode = { type?: string; attrs?: Record<string, unknown> };

function blockHasH3(block: Block): boolean {
  if (block.type !== "richtext" || !block.content) return false;
  try {
    const doc = JSON.parse(block.content) as { content?: TiptapNode[] };
    return (doc.content || []).some((n) => n.type === "heading" && n.attrs?.level === 3);
  } catch {
    return false;
  }
}

function blockHasH2(block: Block): boolean {
  if (block.type !== "richtext" || !block.content) return false;
  try {
    const doc = JSON.parse(block.content) as { content?: TiptapNode[] };
    return (doc.content || []).some((n) => n.type === "heading" && n.attrs?.level === 2);
  } catch {
    return false;
  }
}

export default function BlockList({
  blocks,
  item,
  editable,
  onInsertBlock,
  onUpdateBlock,
  onDeleteBlock,
  onReorder,
}: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [slashMenu, setSlashMenu] = useState<{
    afterBlockId: string;
    position: { x: number; y: number };
  } | null>(null);

  // Compute which blocks should be indented:
  // Blocks that come after an H3 block, until the next H3 or H2 block
  const indentMap = useMemo(() => {
    const map = new Map<string, boolean | "h3">();
    let afterH3 = false;
    for (const b of blocks) {
      if (blockHasH3(b)) {
        afterH3 = true;
        map.set(b.id, "h3"); // H3 heading: not indented but tight spacing
      } else if (blockHasH2(b)) {
        afterH3 = false;
        map.set(b.id, false);
      } else {
        map.set(b.id, afterH3);
      }
    }
    return map;
  }, [blocks]);

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={(e) => {
          if (e.over && e.active.id !== e.over.id)
            onReorder(e.active.id as string, e.over.id as string);
        }}
      >
        <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          {blocks.map((block) => (
            <BlockWrapper
              key={block.id}
              id={block.id}
              editable={editable}
              indented={indentMap.get(block.id)}
              onAddBlock={(e) =>
                setSlashMenu({ afterBlockId: block.id, position: { x: e.clientX, y: e.clientY } })
              }
              onDeleteBlock={() => onDeleteBlock(block.id)}
            >
              <BlockRenderer
                block={block}
                item={item}
                editable={editable}
                onUpdateBlock={onUpdateBlock}
              />
            </BlockWrapper>
          ))}
        </SortableContext>
      </DndContext>

      {slashMenu && (
        <SlashCommandMenu
          position={slashMenu.position}
          onSelect={(type, initialContent) => {
            onInsertBlock(slashMenu.afterBlockId, type, initialContent);
            setSlashMenu(null);
          }}
          onClose={() => setSlashMenu(null)}
        />
      )}
    </>
  );
}
