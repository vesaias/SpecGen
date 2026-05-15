import type { Block, SpecItem } from "../../types";
import CalloutBlock from "./CalloutBlock";
import CodeBlock from "./CodeBlock";
import ImageBlock from "./ImageBlock";
import ResponseBlock from "./ResponseBlock";
import RichtextBlock from "./RichtextBlock";
import TableBlock from "./TableBlock";

interface Props {
  block: Block;
  item: SpecItem;
  editable: boolean;
  onUpdateBlock: (blockId: string, updates: Partial<Block>) => void;
}

export default function BlockRenderer({ block, item, editable, onUpdateBlock }: Props) {
  switch (block.type) {
    case "richtext":
      return (
        <RichtextBlock
          content={block.content || ""}
          editable={editable}
          onChange={(content) => onUpdateBlock(block.id, { content })}
        />
      );

    case "code":
      return (
        <CodeBlock
          content={block.content || ""}
          editable={editable}
          onChange={(content) => onUpdateBlock(block.id, { content })}
        />
      );

    case "callout":
      return (
        <CalloutBlock
          content={block.content || ""}
          variant={(block.meta?.variant as "info" | "warning" | "tip" | undefined) ?? "info"}
          editable={editable}
          onChange={(content) => onUpdateBlock(block.id, { content })}
        />
      );

    case "table":
      return (
        <TableBlock
          table={block.table || { columns: ["Column 1"], rows: [[""]] }}
          editable={editable}
          onChange={(table) => onUpdateBlock(block.id, { table })}
        />
      );

    case "response":
      return (
        <ResponseBlock
          responses={block.responses || []}
          editable={editable}
          onChange={(responses) => onUpdateBlock(block.id, { responses })}
        />
      );

    case "image":
      return (
        <ImageBlock
          src={(block.meta?.src as string | undefined) ?? ""}
          editable={editable}
          onChange={(src) => onUpdateBlock(block.id, { meta: { ...block.meta, src } })}
        />
      );

    default:
      return (
        <div className="text-stone-400 dark:text-stone-600 text-sm">
          Unknown block type: {block.type}
        </div>
      );
  }
}
