/**
 * smart-tree — Built-in generator that asks an AI to propose a meaningful
 * sidebar folder structure grouped by business domain rather than by
 * controller class name.
 *
 * Pipeline:
 * 1. Read the existing spec — error if none (run full-tree-spec first)
 * 2. Load every item via listItemIds + readItem to get full titles/summaries
 * 3. Guard: fewer than 3 items → too little signal, warn + skip AI call
 * 4. Render smart-tree prompt with { items, currentTree }
 * 5. Call AI (single call, 4000 max tokens)
 * 6. Parse and VALIDATE the response:
 *    - every input id must appear exactly once
 *    - no unknown ids
 *    - no duplicates
 *    If validation fails → warn, leave tree unchanged, record status in aiCalls
 * 7. Write the new tree to spec.json (items untouched)
 * 8. Yield item-updated "__tree__" + done
 *
 * This generator is opt-in: the user explicitly clicks "Reorganize with AI"
 * in the sidebar. It does NOT auto-run after every parse.
 */

import { renderPrompt } from "../../ai/PromptRenderer.js";
import { calcCost } from "../../ai/pricing.js";
import { safeParseJson } from "../../ai/safeParseJson.js";
import { emptyRunSummary } from "../../run/RunSummary.js";
import type { Spec, TreeNode } from "../../spec/types.js";
import type { GeneratorAiCallSummary, GeneratorContext, GeneratorPlugin } from "../Generator.js";

/** Recursively collect all non-folder ids from a tree, tracking duplicates */
function collectOutputIds(nodes: TreeNode[]): { ids: Set<string>; duplicates: string[] } {
  const ids = new Set<string>();
  const duplicates: string[] = [];
  function walk(ns: TreeNode[]): void {
    for (const n of ns) {
      if (n.type !== "folder") {
        if (ids.has(n.id)) duplicates.push(n.id);
        ids.add(n.id);
      }
      if (n.children) walk(n.children);
    }
  }
  walk(nodes);
  return { ids, duplicates };
}

type ItemKind = "backend" | "frontend" | "event" | "handler";
type Bucket = "backend" | "frontend" | "events";

/** Map an item kind to its top-level bucket. */
function bucketOf(kind: ItemKind): Bucket {
  if (kind === "backend") return "backend";
  if (kind === "frontend") return "frontend";
  return "events"; // event + handler share one bucket
}

/**
 * Walk the AI-proposed tree and split it into per-bucket sub-trees. Each
 * feature folder the AI created is REPLICATED once per bucket it has items
 * in — preserving the AI's semantic grouping inside each kind. A folder
 * with no items of a given kind doesn't show up in that bucket.
 *
 * `kindOf` returns the item's kind, or null for ids the caller doesn't
 * recognise (those are dropped — AI shouldn't produce unknown ids since
 * validation runs before this, but defensive against bugs).
 */
function splitTreeByBucket(
  nodes: TreeNode[],
  kindOf: (id: string) => ItemKind | null,
): Record<Bucket, TreeNode[]> {
  const out: Record<Bucket, TreeNode[]> = { backend: [], frontend: [], events: [] };
  for (const node of nodes) {
    if (node.type !== "folder") {
      const k = kindOf(node.id);
      if (k) out[bucketOf(k)].push(node);
      continue;
    }
    const childSplit = splitTreeByBucket(node.children ?? [], kindOf);
    for (const b of ["backend", "frontend", "events"] as const) {
      if (childSplit[b].length > 0) {
        // Suffix the folder id with the bucket so duplicated folders don't
        // collide on id. Label stays the same so the user sees consistent
        // group names across buckets.
        out[b].push({
          id: `${node.id}-${b}`,
          type: "folder",
          label: node.label,
          children: childSplit[b],
        });
      }
    }
  }
  return out;
}

/**
 * Force a top-level Backend / Frontend / Events & Handlers split on whatever
 * the AI proposed. The AI is asked to group by feature; this layer mechanically
 * enforces the kind separation so backend endpoints can never end up mixed
 * with frontend pages in the same top-level folder.
 *
 * Buckets with no items are dropped entirely.
 */
function enforceKindSplit(aiTree: TreeNode[], itemKinds: Map<string, ItemKind>): TreeNode[] {
  const split = splitTreeByBucket(aiTree, (id) => itemKinds.get(id) ?? null);
  const finalTree: TreeNode[] = [];
  if (split.backend.length > 0) {
    finalTree.push({
      id: "backend",
      type: "folder",
      label: "Backend",
      children: split.backend,
    });
  }
  if (split.frontend.length > 0) {
    finalTree.push({
      id: "frontend",
      type: "folder",
      label: "Frontend",
      children: split.frontend,
    });
  }
  if (split.events.length > 0) {
    finalTree.push({
      id: "events",
      type: "folder",
      label: "Events & Handlers",
      children: split.events,
    });
  }
  return finalTree;
}

export const smartTreeGenerator: GeneratorPlugin = {
  id: "smart-tree",
  name: "Smart tree",
  description:
    "Asks an AI to propose a semantic folder structure for the spec sidebar, grouping items by business domain instead of controller class.",
  supports_profiles: "*",
  supports_parsers: "*",
  produces_item_types: [],

  async *run(ctx: GeneratorContext) {
    // ------------------------------------------------------------------
    // 1. Read existing spec
    // ------------------------------------------------------------------
    yield { type: "progress" as const, message: "Reading existing spec…" };
    const spec = await ctx.spec.read();
    if (!spec) {
      yield {
        type: "error" as const,
        error: new Error("smart-tree requires an existing spec — run full-tree-spec first"),
      };
      yield { type: "done" as const, stats: emptyRunSummary() };
      return;
    }

    // ------------------------------------------------------------------
    // 2. Load items with full summaries
    // ------------------------------------------------------------------
    const itemIds = await ctx.spec.listItemIds();
    const items: Array<{ id: string; type: string; title: string; summary?: string }> = [];
    for (const id of itemIds) {
      const item = await ctx.spec.readItem(id);
      if (!item) continue;
      items.push({
        id: item.id,
        type: item.type,
        title: item.title,
        // BackendSpecItem + EventSpecItem have `summary`; FrontendSpecItem does not.
        summary: (item as unknown as { summary?: string }).summary,
      });
    }

    // ------------------------------------------------------------------
    // 3. Guard: too few items
    // ------------------------------------------------------------------
    if (items.length < 3) {
      yield {
        type: "warning" as const,
        message: `Only ${items.length} item(s) found — too few to reorganize meaningfully`,
      };
      yield {
        type: "done" as const,
        stats: {
          itemsCreated: 0,
          itemsUpdated: 0,
          itemsRemoved: 0,
          warnings: 1,
          aiCalls: [],
          aiCostUsdTotal: 0,
        },
      };
      return;
    }

    // ------------------------------------------------------------------
    // 4. Render prompt
    // ------------------------------------------------------------------
    yield {
      type: "progress" as const,
      message: `Asking AI to reorganize ${items.length} item(s)…`,
    };

    const { system, user } = await renderPrompt({
      profile: ctx.profile,
      itemType: "smart-tree",
      guidelines: ctx.guidelines ?? "",
      variables: { items, currentTree: spec.tree },
    });

    // ------------------------------------------------------------------
    // 5. Call AI
    // ------------------------------------------------------------------
    const model = ctx.aiOverrides?.model ?? ctx.profile.manifest.ai.default_model;
    const provider = ctx.ai.primaryProvider;
    const t0 = Date.now();
    const result = await ctx.ai.complete({
      prompt: user,
      system,
      model,
      temperature: ctx.aiOverrides?.temperature ?? 0.3,
      maxTokens: ctx.aiOverrides?.maxTokens ?? 4000,
      signal: ctx.signal,
    });
    const durationMs = Date.now() - t0;
    const u = result.usage;
    const cost = calcCost(
      provider,
      model,
      u.input_tokens,
      u.output_tokens,
      u.cache_read_tokens,
      u.cache_write_tokens,
    );

    // ------------------------------------------------------------------
    // 6a. Parse AI response
    // ------------------------------------------------------------------
    const parsed = safeParseJson(result.text) as { tree?: TreeNode[] } | null;
    if (!parsed || !Array.isArray(parsed.tree)) {
      yield {
        type: "warning" as const,
        message: "Smart-tree AI returned unparseable JSON; tree unchanged",
      };
      const aiCall: GeneratorAiCallSummary = {
        itemId: "__tree__",
        provider,
        model,
        durationMs,
        costUsd: cost,
        usage: u,
        status: "json_parse_failed",
        error: "AI response was not valid JSON with a tree array",
      };
      yield {
        type: "done" as const,
        stats: {
          itemsCreated: 0,
          itemsUpdated: 0,
          itemsRemoved: 0,
          warnings: 1,
          aiCalls: [aiCall],
          aiCostUsdTotal: cost,
        },
      };
      return;
    }

    // ------------------------------------------------------------------
    // 6b. Validate: every input id must appear exactly once, no unknowns
    // ------------------------------------------------------------------
    const inputIds = new Set(items.map((i) => i.id));
    const { ids: outputIds, duplicates } = collectOutputIds(parsed.tree);

    const missing = [...inputIds].filter((id) => !outputIds.has(id));
    const extra = [...outputIds].filter((id) => !inputIds.has(id));

    if (missing.length > 0 || extra.length > 0 || duplicates.length > 0) {
      const parts: string[] = [];
      if (missing.length > 0) {
        parts.push(`${missing.length} missing item(s) (${missing.slice(0, 3).join(", ")})`);
      }
      if (extra.length > 0) {
        parts.push(`${extra.length} unknown item(s) (${extra.slice(0, 3).join(", ")})`);
      }
      if (duplicates.length > 0) {
        parts.push(`${duplicates.length} duplicate(s) (${duplicates.slice(0, 3).join(", ")})`);
      }
      const msg = `Smart-tree validation failed (${parts.join("; ")}); tree unchanged`;
      yield { type: "warning" as const, message: msg };
      const aiCall: GeneratorAiCallSummary = {
        itemId: "__tree__",
        provider,
        model,
        durationMs,
        costUsd: cost,
        usage: u,
        status: "schema_invalid",
        error: msg,
      };
      yield {
        type: "done" as const,
        stats: {
          itemsCreated: 0,
          itemsUpdated: 0,
          itemsRemoved: 0,
          warnings: 1,
          aiCalls: [aiCall],
          aiCostUsdTotal: cost,
        },
      };
      return;
    }

    // ------------------------------------------------------------------
    // 7. Enforce top-level Backend / Frontend / Events split. The AI is
    //    asked to group by feature; this post-pass mechanically guarantees
    //    that backend endpoints never share a top-level folder with frontend
    //    pages. Each AI-proposed feature folder is replicated once per bucket
    //    it contains items in.
    // ------------------------------------------------------------------
    const itemKinds = new Map<string, ItemKind>();
    for (const it of items) {
      if (
        it.type === "backend" ||
        it.type === "frontend" ||
        it.type === "event" ||
        it.type === "handler"
      ) {
        itemKinds.set(it.id, it.type);
      }
    }
    const finalTree = enforceKindSplit(parsed.tree, itemKinds);

    // ------------------------------------------------------------------
    // 8. Write the new tree (items untouched)
    // ------------------------------------------------------------------
    const newSpec: Spec = { ...spec, tree: finalTree };
    await ctx.spec.write(newSpec);

    yield { type: "item-updated" as const, itemId: "__tree__" };

    const aiCall: GeneratorAiCallSummary = {
      itemId: "__tree__",
      provider,
      model,
      durationMs,
      costUsd: cost,
      usage: u,
      status: "ok",
    };

    yield {
      type: "done" as const,
      stats: {
        itemsCreated: 0,
        itemsUpdated: 1,
        itemsRemoved: 0,
        warnings: 0,
        aiCalls: [aiCall],
        aiCostUsdTotal: cost,
      },
    };
  },
};
