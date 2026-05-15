import type {
  BackendSpecItem,
  Block,
  EventSpecItem,
  FrontendSpecItem,
  HandlerSpecItem,
  SpecItem,
} from "../spec/types.js";
import { blockToMarkdown } from "./blockToMarkdown.js";

type SpecItemWithBlocks = SpecItem & { blocks?: Block[] };

/**
 * renderItemMarkdown — renders a SpecItem (with optional blocks) to a Markdown string.
 *
 * Layout:
 *   1. YAML frontmatter
 *   2. H1 title
 *   3. Type-specific sections (parameters, responses, etc.)
 *   4. ## Notes  (blocks[], if any)
 */
export function renderItemMarkdown(item: SpecItemWithBlocks): string {
  const fm = renderFrontmatter(item);
  let body = "";
  switch (item.type) {
    case "backend":
      body = renderBackend(item as BackendSpecItem);
      break;
    case "frontend":
      body = renderFrontend(item as FrontendSpecItem);
      break;
    case "event":
      body = renderEvent(item as EventSpecItem);
      break;
    case "handler":
      body = renderHandler(item as HandlerSpecItem);
      break;
  }
  const blocks = (item as SpecItemWithBlocks).blocks;
  const notes = blocks?.length ? `\n## Notes\n\n${blocks.map(blockToMarkdown).join("")}` : "";
  return `${fm}\n# ${item.title}\n\n${body}${notes}`;
}

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

function renderFrontmatter(item: SpecItemWithBlocks): string {
  const fm: Record<string, unknown> = {
    id: item.id,
    type: item.type,
    title: item.title,
    generatedAt: new Date().toISOString(),
  };
  if (item.type === "backend") {
    const b = item as BackendSpecItem;
    fm.method = b.method;
    fm.route = b.route;
    if (b.controller) fm.controller = b.controller;
  } else if (item.type === "frontend") {
    fm.route = (item as FrontendSpecItem).route;
  }
  if (item.sourceFiles?.length) fm.sourceFiles = item.sourceFiles;
  if (item.sourceHash) fm.sourceHash = item.sourceHash;
  return `---\n${Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")}\n---\n`;
}

// ---------------------------------------------------------------------------
// Backend
// ---------------------------------------------------------------------------

function renderBackend(item: BackendSpecItem): string {
  const out: string[] = [];
  if (item.summary) out.push(`> ${item.summary}\n`);
  if (item.context) out.push(`## Context\n\n${item.context}\n`);

  if (item.parameters?.length) {
    out.push("## Parameters\n");
    out.push("| Name | In | Type | Required | Description |\n| --- | --- | --- | --- | --- |");
    for (const p of item.parameters) {
      out.push(
        `| ${p.name} | ${p.location} | ${p.type} | ${p.required ? "yes" : "no"} | ${p.description ?? ""} |`,
      );
    }
    out.push("");
  }

  if (item.requestBody) {
    out.push(`## Request body — \`${item.requestBody.dtoName}\`\n`);
    out.push(
      "| Field | Type | Required | Description | Validation |\n| --- | --- | --- | --- | --- |",
    );
    for (const f of item.requestBody.fields) {
      out.push(
        `| ${f.name} | ${f.type} | ${f.required ? "yes" : "no"} | ${f.description ?? ""} | ${f.validation ?? ""} |`,
      );
    }
    out.push("");
  }

  if (item.orchestration?.length) {
    out.push("## Orchestration\n");
    for (const s of item.orchestration) {
      out.push(`${s.step}. **${s.call}** — ${s.description}`);
    }
    out.push("");
  }

  if (item.responses?.length) {
    out.push("## Responses\n");
    for (const r of item.responses) {
      out.push(`### HTTP ${r.status}${r.type ? ` (${r.type})` : ""}\n`);
      if (r.description) out.push(`${r.description}\n`);
      if (r.responseExample) out.push(`\`\`\`json\n${r.responseExample}\n\`\`\`\n`);
    }
  }

  if (item.validationRules?.length) {
    out.push("## Validation rules\n");
    out.push("| Field | Rule | Message |\n| --- | --- | --- |");
    for (const v of item.validationRules) {
      out.push(`| ${v.field} | ${v.rule} | ${v.message ?? ""} |`);
    }
    out.push("");
  }

  if (item.dependencies?.length) {
    out.push("## Dependencies\n");
    for (const d of item.dependencies) out.push(`- ${d}`);
    out.push("");
  }

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Frontend
// ---------------------------------------------------------------------------

function renderFrontend(item: FrontendSpecItem): string {
  const out: string[] = [];
  if (item.context) out.push(`## Context\n\n${item.context}\n`);

  if (item.sections?.length) {
    out.push("## Sections\n");
    for (const s of item.sections) {
      out.push(`### ${s.id} — \`${s.component}\`\n`);
      if (s.elements?.length) {
        out.push("| Tag | Type | Name | Editable | Source |\n| --- | --- | --- | --- | --- |");
        for (const e of s.elements) {
          out.push(
            `| ${e.tag} | ${e.type ?? ""} | ${e.name ?? ""} | ${e.editable ? "yes" : "no"} | ${e.source ?? ""} |`,
          );
        }
        out.push("");
      }
    }
  }

  if (item.state?.length) {
    out.push("## State\n");
    out.push("| Name | Type | Initial value |\n| --- | --- | --- |");
    for (const s of item.state) out.push(`| ${s.name} | ${s.type} | ${s.initialValue ?? ""} |`);
    out.push("");
  }

  if (item.actions?.length) {
    out.push("## Actions\n");
    out.push(
      "| Trigger | Method | Endpoint | On success | On error |\n| --- | --- | --- | --- | --- |",
    );
    for (const a of item.actions) {
      out.push(
        `| ${a.trigger} | ${a.method ?? ""} | ${a.endpoint ?? ""} | ${a.onSuccess ?? ""} | ${a.onError ?? ""} |`,
      );
    }
    out.push("");
  }

  if (item.navigation?.length) {
    out.push("## Navigation\n");
    out.push("| To | Trigger | Condition |\n| --- | --- | --- |");
    for (const n of item.navigation) out.push(`| ${n.to} | ${n.trigger} | ${n.condition ?? ""} |`);
    out.push("");
  }

  if (item.apiCalls?.length) {
    out.push("## API calls\n");
    out.push("| Hook | Type | Method | Endpoint |\n| --- | --- | --- | --- |");
    for (const c of item.apiCalls)
      out.push(`| ${c.hook} | ${c.type} | ${c.method} | ${c.endpoint} |`);
    out.push("");
  }

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------

function renderEvent(item: EventSpecItem): string {
  const out: string[] = [];
  if (item.summary) out.push(`> ${item.summary}\n`);
  if (item.context) out.push(`## Context\n\n${item.context}\n`);

  if (item.payload?.length) {
    out.push("## Payload\n");
    out.push("| Field | Type | Description |\n| --- | --- | --- |");
    for (const p of item.payload) out.push(`| ${p.name} | ${p.type} | ${p.description ?? ""} |`);
    out.push("");
  }

  if (item.payloadExample) {
    out.push(`### Example\n\n\`\`\`json\n${item.payloadExample}\n\`\`\`\n`);
  }

  if (item.triggers?.length) {
    out.push("## Triggers\n");
    out.push("| Service | Method | Endpoint |\n| --- | --- | --- |");
    for (const t of item.triggers) out.push(`| ${t.service} | ${t.method} | ${t.endpoint ?? ""} |`);
    out.push("");
  }

  if (item.handler) {
    out.push(`## Handler\n\n\`${item.handler}\`\n`);
    if (item.handlerDescription) out.push(`${item.handlerDescription}\n`);
  }

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

function renderHandler(item: HandlerSpecItem): string {
  const out: string[] = [];
  if (item.description) out.push(`${item.description}\n`);
  if (item.listensTo?.length) {
    out.push("## Listens to\n");
    for (const e of item.listensTo) out.push(`- \`${e}\``);
    out.push("");
  }
  return out.join("\n");
}
