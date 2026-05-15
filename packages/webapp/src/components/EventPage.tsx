import { useBlocks } from "../hooks/useBlocks";
import type { Block, EventItem, SpecItem } from "../types";
import { wrapHeading, wrapPlainText } from "../utils/tiptapHelpers";
import BlockList from "./blocks/BlockList";

interface Props {
  item: EventItem;
  editable: boolean;
  version: string;
  editToggle: React.ReactNode;
  onUpdate: (updates: Partial<SpecItem>) => void;
}

function buildDefaultBlocks(item: EventItem): Block[] {
  const blocks: Block[] = [];
  blocks.push({ id: "summary", type: "richtext", content: wrapPlainText(item.summary) });

  // Producers / Consumers — frame the event as a data contract.
  // One row per trigger (Producer), one row for the handler (Consumer).
  const hasTriggers = item.triggers?.length > 0;
  const hasHandler = !!item.handler && item.type !== "handler";
  if (hasTriggers || hasHandler) {
    blocks.push({
      id: "pc-heading",
      type: "richtext",
      content: wrapHeading("Producers / Consumers", 2),
    });
    const rows: string[][] = [];
    if (hasTriggers) {
      for (const t of item.triggers) {
        rows.push(["Producer", `${t.method} ${t.endpoint}`]);
      }
    }
    if (hasHandler) {
      rows.push(["Consumer", item.handler]);
    }
    blocks.push({
      id: "pc",
      type: "table",
      table: {
        columns: ["Role", "Reference"],
        rows,
      },
    });
  }

  // Payload group
  if (item.payload?.length > 0) {
    blocks.push({
      id: "payload-section",
      type: "richtext",
      content: wrapHeading("Payload", 2),
    });
    blocks.push({
      id: "payload-heading",
      type: "richtext",
      content: wrapHeading("Fields", 3),
    });
    blocks.push({
      id: "payload",
      type: "table",
      table: {
        columns: ["Field", "Type", "Description"],
        rows: item.payload.map((p) => [p.name, p.type, p.description]),
      },
    });
    if (item.payloadExample) {
      blocks.push({
        id: "payload-example-heading",
        type: "richtext",
        content: wrapHeading("Example", 3),
      });
      blocks.push({ id: "payload-example", type: "code", content: item.payloadExample });
    }
  }

  // If this item is itself a HANDLER, keep the handler-description section —
  // the handler's behavior IS the point of a handler page. For regular events
  // the handler reference now lives in the Producers/Consumers table above
  // and the handler's behavior belongs on the handler's own spec page.
  if (item.type === "handler" && item.handler) {
    blocks.push({
      id: "handler-heading",
      type: "richtext",
      content: wrapHeading(`Handler — ${item.handler}`, 3),
    });
    blocks.push({
      id: "handler",
      type: "richtext",
      content: wrapPlainText(item.handlerDescription === "[TODO]" ? "" : item.handlerDescription),
    });
  }

  return blocks;
}

export default function EventPage({ item, editable, version, editToggle, onUpdate }: Props) {
  const { blocks, updateBlockContent, insertBlock, deleteBlock, reorderBlocks } = useBlocks(
    item,
    editable,
    () => buildDefaultBlocks(item),
    onUpdate,
  );

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          {item.type === "handler" ? (
            <span className="bg-cyan-600 text-white text-xs font-bold uppercase px-3 py-1.5 rounded-md tracking-wide">
              Handler
            </span>
          ) : (
            <span className="bg-amber-500 text-white text-xs font-bold uppercase px-3 py-1.5 rounded-md tracking-wide">
              Event
            </span>
          )}
          <h1 className="text-xl font-semibold text-stone-800 dark:text-stone-100 flex-1">
            {item.title}
          </h1>
          {editToggle}
        </div>
        <div className="flex items-center gap-2 mt-3 text-xs text-stone-400 dark:text-stone-600">
          <span className="bg-brand-600 dark:bg-brand-500 text-white px-2 py-0.5 rounded text-[10px] font-semibold">
            {version}
          </span>
        </div>
        {item.sourceFiles?.length > 0 && (
          <details className="mt-1.5 text-[11px] text-stone-400 dark:text-stone-600">
            <summary className="cursor-pointer hover:text-brand-600 dark:hover:text-brand-300">
              {item.sourceFiles?.length} source file{item.sourceFiles?.length > 1 ? "s" : ""}
            </summary>
            <div className="mt-1 pl-4 font-mono">
              {item.sourceFiles.map((f) => (
                <div key={f}>{f}</div>
              ))}
            </div>
          </details>
        )}
      </div>

      <BlockList
        blocks={blocks}
        item={item}
        editable={editable}
        onInsertBlock={insertBlock}
        onUpdateBlock={updateBlockContent}
        onDeleteBlock={deleteBlock}
        onReorder={reorderBlocks}
      />
    </div>
  );
}
