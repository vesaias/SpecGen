import { useBlocks } from "../hooks/useBlocks";
import type { BackendItem, Block, OrchestrationStep, SpecItem } from "../types";
import { wrapHeading, wrapPlainText } from "../utils/tiptapHelpers";
import MethodBadge from "./MethodBadge";
import OrchestrationSteps from "./OrchestrationSteps";
import BlockList from "./blocks/BlockList";

interface Props {
  item: BackendItem;
  editable: boolean;
  version: string;
  editToggle: React.ReactNode;
  onUpdate: (updates: Partial<SpecItem>) => void;
}

function buildDefaultBlocks(item: BackendItem): Block[] {
  const blocks: Block[] = [];
  blocks.push({ id: "summary", type: "richtext", content: wrapPlainText(item.summary) });

  // Request group: parameters, request body, validation rules
  const hasParams = item.parameters?.length > 0;
  const hasReqBody = !!item.requestBody;
  const hasValidation = item.validationRules?.length > 0;
  if (hasParams || hasReqBody || hasValidation) {
    blocks.push({
      id: "req-heading",
      type: "richtext",
      content: wrapHeading("Request", 2),
    });
  }
  if (hasParams) {
    blocks.push({
      id: "params-heading",
      type: "richtext",
      content: wrapHeading("Parameters", 3),
    });
    blocks.push({
      id: "params",
      type: "table",
      table: {
        columns: ["Parameter", "In", "Type", "Required", "Description"],
        rows: item.parameters.map((p) => [
          p.name,
          p.location,
          p.type,
          p.required ? "✓" : "",
          p.description,
        ]),
      },
    });
  }
  if (hasReqBody && item.requestBody) {
    blocks.push({
      id: "reqbody-heading",
      type: "richtext",
      content: wrapHeading(`Body — ${item.requestBody.dtoName}`, 3),
    });
    blocks.push({
      id: "reqbody",
      type: "table",
      table: {
        columns: ["Field", "Type", "Required", "Description", "Validation"],
        rows: item.requestBody.fields.map((f) => [
          f.name,
          f.type,
          f.required ? "✓" : "",
          f.description,
          f.validation || "",
        ]),
      },
    });
  }
  if (hasValidation) {
    blocks.push({
      id: "val-heading",
      type: "richtext",
      content: wrapHeading("Validation", 3),
    });
    blocks.push({
      id: "val",
      type: "table",
      table: {
        columns: ["Field", "Rule", "Message"],
        rows: item.validationRules.map((v) => [v.field, v.rule, v.message || ""]),
      },
    });
  }

  // Response group
  if (item.responses?.length > 0) {
    blocks.push({
      id: "resp-section",
      type: "richtext",
      content: wrapHeading("Response", 2),
    });
    blocks.push({
      id: "resp-heading",
      type: "richtext",
      content: wrapHeading("Fields", 3),
    });
    blocks.push({
      id: "resp",
      type: "response",
      responses: item.responses.map((r) => ({
        status: r.status,
        description: `${r.type ? `${r.type} — ` : ""}${r.description}`,
        body: r.responseExample || "",
      })),
    });
  }

  // Note: orchestration intentionally NOT added to the block list — it renders
  // outside BlockList via <OrchestrationSteps> in the page body so we get
  // structured numbered badges + code-styled call labels per step.
  return blocks;
}

export default function BackendPage({ item, editable, version, editToggle, onUpdate }: Props) {
  const { blocks, updateBlockContent, insertBlock, deleteBlock, reorderBlocks } = useBlocks(
    item,
    editable,
    () => buildDefaultBlocks(item),
    onUpdate,
  );

  const handleUpdateOrchStep = (stepIndex: number, description: string) => {
    const current = item.orchestration || [];
    const next: OrchestrationStep[] = current.map((s, i) =>
      i === stepIndex ? { ...s, description } : s,
    );
    onUpdate({ orchestration: next } as Partial<SpecItem>);
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          {item.method && <MethodBadge method={item.method} size="md" />}
          <h1 className="text-xl font-mono font-semibold text-stone-800 dark:text-stone-100 tracking-tight flex-1">
            {item.route || item.title}
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

      {item.orchestration?.length > 0 && (
        <div className="mt-8">
          <h2 className="text-lg font-semibold text-stone-800 dark:text-stone-100 mb-4 pb-2 border-b border-stone-200 dark:border-stone-800">
            Business Logic
          </h2>
          <OrchestrationSteps
            steps={item.orchestration}
            editable={editable}
            onUpdateStep={handleUpdateOrchStep}
          />
        </div>
      )}
    </div>
  );
}
