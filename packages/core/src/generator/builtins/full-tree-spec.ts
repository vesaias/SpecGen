/**
 * full-tree-spec — Built-in generator that ports the legacy specgen/index.ts pipeline.
 *
 * Pipeline:
 * 1. detectAll(rootDir) — find applicable parsers
 * 2. parse each detected parser
 * 3. Build SpecItems from ParseResults (no AI enrichment — Phase B)
 * 4. read existing Spec via SpecRepository
 * 5. mergeSpec(parsed, existing) for each item — preserves human edits
 * 6. Build / update the tree (preserves user reorderings)
 * 7. write back via SpecRepository
 * 8. yield events throughout
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import PQueue from "p-queue";
import { renderPrompt } from "../../ai/PromptRenderer.js";
import { mergeAiEnrichment } from "../../ai/mergeAiEnrichment.js";
import { canonicalItemType, schemaForItemType } from "../../ai/outputSchema.js";
import { calcCost } from "../../ai/pricing.js";
import { safeParseJson } from "../../ai/safeParseJson.js";
import { readSourceCode } from "../../ai/sourceCodeReader.js";
import { LocalFs } from "../../parser/LocalFs.js";
import type { ParserPlugin } from "../../parser/Parser.js";
import type { BackendSpec, EventSpec, FrontendSpec, ParseResult } from "../../parser/types.js";
import { mergeSpec } from "../../spec/mergeSpec.js";
import { isTodoSentinel } from "../../spec/sentinels.js";
import type {
  BackendSpecItem,
  EventSpecItem,
  FrontendSpecItem,
  Spec,
  SpecItem,
  SpecMeta,
  TreeNode,
} from "../../spec/types.js";
import type { ParserMode } from "../../types.js";
import type {
  GeneratorAiCallSummary,
  GeneratorContext,
  GeneratorEvent,
  GeneratorPlugin,
} from "../Generator.js";

// ---------------------------------------------------------------------------
// Id derivation (matches legacy specgen/index.ts conventions exactly)
// ---------------------------------------------------------------------------

function makeBackendId(s: BackendSpec): string {
  return `${s.method}-${s.route}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function makeFrontendId(s: FrontendSpec): string {
  return `page-${s.page}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function makeEventId(s: EventSpec): string {
  return `event-${s.name.replace("Event", "")}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

// ---------------------------------------------------------------------------
// Source hash (matches legacy specgen/index.ts:hashSourceFiles)
// ---------------------------------------------------------------------------

function hashSourceFiles(sourceFiles: string[], rootDir: string): string {
  const hash = createHash("sha256");
  for (const f of [...sourceFiles].sort()) {
    const abs = path.isAbsolute(f) ? f : path.resolve(rootDir, f);
    try {
      if (existsSync(abs)) {
        hash.update(readFileSync(abs, "utf-8"));
      }
    } catch {
      // ignore unreadable files — same as legacy
    }
  }
  return hash.digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Item builders (parser → SpecItem, with [TODO] placeholders for AI fields)
// ---------------------------------------------------------------------------

function buildBackendItem(s: BackendSpec, rootDir: string): BackendSpecItem {
  const id = makeBackendId(s);
  return {
    id,
    type: "backend",
    title: `${s.method} ${s.route}`,
    method: s.method,
    route: s.route,
    controller: s.controller,
    summary: s.summary || "",
    context: s.context || "",
    parameters: s.parameters || [],
    requestBody: s.requestBody,
    responses: s.responses || [],
    validationRules: s.validationRules || [],
    orchestration: s.orchestration || [],
    dependencies: s.dependencies || [],
    sourceFiles: s.sourceFiles || [],
    sourceHash: hashSourceFiles(s.sourceFiles || [], rootDir),
  };
}

function buildFrontendItem(s: FrontendSpec, rootDir: string): FrontendSpecItem {
  const id = makeFrontendId(s);
  return {
    id,
    type: "frontend",
    title: s.page,
    route: s.route,
    context: s.context || "",
    sections: s.sections || [],
    navigation: s.navigation || [],
    actions: s.actions || [],
    state: s.state || [],
    apiCalls: s.apiCalls || [],
    sourceFiles: s.sourceFiles || [],
    sourceHash: hashSourceFiles(s.sourceFiles || [], rootDir),
  };
}

function buildEventItem(s: EventSpec, rootDir: string): EventSpecItem {
  const id = makeEventId(s);
  return {
    id,
    type: "event",
    title: s.name,
    summary: s.summary || "",
    context: s.context || "",
    payload: s.payload || [],
    payloadExample: s.payloadExample || "",
    triggers: s.triggers || [],
    handler: s.handler || "",
    handlerDescription: s.handlerDescription || "",
    sourceFiles: s.sourceFiles || [],
    sourceHash: hashSourceFiles(s.sourceFiles || [], rootDir),
  };
}

// ---------------------------------------------------------------------------
// Tree building (matches legacy index.ts:buildDefaultTree + prune logic)
// ---------------------------------------------------------------------------

function buildDefaultTree(
  endpoints: BackendSpec[],
  pages: FrontendSpec[],
  events: EventSpec[],
): TreeNode[] {
  const tree: TreeNode[] = [];

  // Backend folder → controller sub-folders → endpoints
  if (endpoints.length > 0 || events.length > 0) {
    const backendChildren: TreeNode[] = [];
    const controllerGroups = new Map<string, string[]>();
    for (const s of endpoints) {
      const group = s.controller.replace("Controller", "");
      if (!controllerGroups.has(group)) controllerGroups.set(group, []);
      controllerGroups.get(group)?.push(makeBackendId(s));
    }
    for (const [group, ids] of controllerGroups) {
      backendChildren.push({
        id: group.toLowerCase(),
        type: "folder",
        label: group.replace(/([A-Z])/g, " $1").trim(),
        children: ids.map((id) => ({ id, type: "backend" as const })),
      });
    }
    if (events.length > 0) {
      backendChildren.push({
        id: "domain-events",
        type: "folder",
        label: "Domain Events",
        children: events.map((s) => ({ id: makeEventId(s), type: "event" as const })),
      });
    }
    if (backendChildren.length > 0) {
      tree.push({ id: "backend", type: "folder", label: "Backend", children: backendChildren });
    }
  }

  // Frontend folder — flat pages
  if (pages.length > 0) {
    tree.push({
      id: "frontend",
      type: "folder",
      label: "Frontend",
      children: pages.map((s) => ({ id: makeFrontendId(s), type: "frontend" as const })),
    });
  }

  return tree;
}

/**
 * Given an existing tree and the fresh set of item ids, prune stale nodes
 * and add new items into an "uncategorized" folder (preserving user reorderings).
 */
function updateExistingTree(
  existingTree: TreeNode[],
  freshItemIds: Set<string>,
  allItemIds: Set<string>,
): TreeNode[] {
  // Collect which ids appear in the existing tree
  const existingItemIds = new Set<string>();
  function collectIds(nodes: TreeNode[]) {
    for (const n of nodes) {
      if (n.type !== "folder") existingItemIds.add(n.id);
      if (n.children) collectIds(n.children);
    }
  }
  collectIds(existingTree);

  // New items not yet in the existing tree
  const newItemIds = [...freshItemIds].filter((id) => !existingItemIds.has(id));

  // Prune: remove item nodes whose ids are no longer in allItemIds; remove empty folders
  function pruneTree(nodes: TreeNode[]): TreeNode[] {
    return nodes
      .map((n): TreeNode | null => {
        if (n.type === "folder") {
          const pruned = pruneTree(n.children || []);
          return pruned.length > 0 ? { ...n, children: pruned } : null;
        }
        return allItemIds.has(n.id) ? n : null;
      })
      .filter((n): n is TreeNode => n !== null);
  }

  let tree = pruneTree(existingTree);

  // Append uncategorized folder for new items
  if (newItemIds.length > 0) {
    tree = [
      ...tree,
      {
        id: "uncategorized",
        type: "folder",
        label: "New (Uncategorized)",
        children: newItemIds.map((id) => {
          // Determine type from id prefix conventions
          const type = id.startsWith("page-")
            ? ("frontend" as const)
            : id.startsWith("event-")
              ? ("event" as const)
              : ("backend" as const);
          return { id, type };
        }),
      },
    ];
  }

  return tree;
}

// ---------------------------------------------------------------------------
// Version string helper
// ---------------------------------------------------------------------------

function versionString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `v${y}.${m}.${day}`;
}

// ---------------------------------------------------------------------------
// AI enrichment helpers (private to this module)
// ---------------------------------------------------------------------------

function hasTodoFields(item: Record<string, unknown>): boolean {
  return Object.values(item).some((v) => isTodoSentinel(v));
}

function stripTodoFields(item: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).filter(([, v]) => !isTodoSentinel(v)));
}

// ---------------------------------------------------------------------------
// Mode-aware enrichment selection
// ---------------------------------------------------------------------------

/**
 * Selection mode for which items are eligible for AI enrichment.
 * - "initial":       only items with [TODO] sentinel fields (Phase B default)
 * - "change-detect": [TODO] items + items whose `sourceHash` drifted from
 *                    `enrichedSourceHash` since last successful enrichment
 * - "single":        only the item whose id matches `targetItemId`
 */
export type EnrichmentMode = "initial" | "change-detect" | "single";

export interface FullTreeSpecOpts {
  /** Read from ctx.options. Defaults to "initial" when not provided. */
  mode?: EnrichmentMode;
  /** Required when mode === "single". */
  targetItemId?: string;
  /**
   * Restrict AI enrichment to these item ids (legacy filter, applied
   * independently of `mode`). Preserved for backwards compat with the existing
   * "re-enrich selected" code path.
   */
  itemIds?: string[];
  /**
   * When true, `shouldEnrich` returns true regardless of mode / drift / TODO
   * state — used by the "Rebuild" action to force re-enrichment of every item.
   * Manual edits are still preserved through `mergeSpec`; only AI-owned fields
   * are overwritten.
   */
  force?: boolean;
}

function shouldEnrich(
  item: Record<string, unknown>,
  mode: EnrichmentMode,
  targetId?: string,
  force?: boolean,
): boolean {
  if (force) return true;
  if (mode === "single") return item.id === targetId;
  const sourceDrift =
    typeof item.sourceHash === "string" &&
    typeof item.enrichedSourceHash === "string" &&
    item.sourceHash !== item.enrichedSourceHash;
  // Capture drift: the Playwright capture wrote new observed data since the
  // last AI run. Treated identically to source drift — both signals mean the
  // current enriched fields are stale w.r.t. the inputs the model would see.
  // Item is also eligible if it has captureHash but no enrichedCaptureHash
  // yet (first AI pass after capture).
  const captureDrift =
    typeof item.captureHash === "string" && item.captureHash !== item.enrichedCaptureHash;
  if (mode === "change-detect") return hasTodoFields(item) || sourceDrift || captureDrift;
  return hasTodoFields(item); // initial
}

// ---------------------------------------------------------------------------
// Generator implementation
// ---------------------------------------------------------------------------

async function* run(ctx: GeneratorContext): AsyncIterable<GeneratorEvent> {
  const { rootDir, parsers, spec, log, ai, guidelines } = ctx;
  const emit = (msg: string) => log?.(msg);

  // Use the fs from context if provided; fall back to LocalFs for backwards compat
  const parserFs = ctx.fs ?? new LocalFs(rootDir);

  const warnings: string[] = [];
  let itemsCreated = 0;
  let itemsUpdated = 0;
  let itemsRemoved = 0;

  // --- 1. Detect applicable parsers ---
  emit("Detecting applicable parsers…");
  yield { type: "progress", message: "Detecting parsers" };
  const detected = await parsers.detectAll(rootDir, parserFs);
  emit(`  ${detected.length} parser(s) detected`);

  // Parser-mode dispatch. Reads from ctx.options.parserMode (caller threads
  // project.parserConfig.parserMode through). Defaults to "rule-only" so
  // pre-existing projects keep their behaviour.
  //
  //   - rule-only:               skip every llm-shaped parser entirely
  //   - rule-plus-llm-fallback:  rule parsers run first; llm parsers run last
  //                              with `mode: "fallback"` + ruleParserOutput
  //   - llm-only:                only llm-shaped parsers run, in "standalone"
  //
  // "llm-shaped" is identified by plugin.id === "llm". Other plugin ids may
  // later use the same dispatch (no need to whitelist here).
  const parserMode = (
    typeof ctx.options?.parserMode === "string"
      ? ((ctx.options as Record<string, unknown>).parserMode as ParserMode)
      : "rule-only"
  ) as ParserMode;

  const isLlmPlugin = (p: ParserPlugin) => p.id === "llm";
  const ruleParsers = detected.filter((d) => !isLlmPlugin(d.plugin));
  const llmParsers = detected.filter((d) => isLlmPlugin(d.plugin));

  let parsersToRun: typeof detected;
  if (parserMode === "llm-only") {
    parsersToRun = llmParsers;
    if (llmParsers.length === 0) {
      warnings.push(
        'Parser mode is "llm-only" but no llm parser was detected; falling back to rule parsers',
      );
      parsersToRun = ruleParsers;
    }
  } else if (parserMode === "rule-plus-llm-fallback") {
    // Rule parsers first, llm last — order matters because the llm parser
    // consumes the accumulated rule output as ruleParserOutput for skipping.
    parsersToRun = [...ruleParsers, ...llmParsers];
  } else {
    parsersToRun = ruleParsers;
  }

  // --- 2. Run parsers ---
  let allEndpoints: BackendSpec[] = [];
  let allPages: FrontendSpec[] = [];
  let allEvents: EventSpec[] = [];

  for (const { plugin, subDirs } of parsersToRun) {
    emit(`  Parsing with ${plugin.name}…`);
    yield { type: "progress", message: `Parsing with ${plugin.name}` };
    try {
      const isLlm = isLlmPlugin(plugin);
      const llmMode = parserMode === "llm-only" ? "standalone" : "fallback";
      const ruleParserOutput: ParseResult | undefined =
        isLlm && parserMode === "rule-plus-llm-fallback"
          ? { endpoints: allEndpoints, pages: allPages, events: allEvents, warnings: [] }
          : undefined;

      const result = await plugin.parse({
        rootDir,
        fs: parserFs,
        subDirs,
        ...(isLlm
          ? {
              aiClient: ai.primaryClient,
              aiModel: ctx.aiOverrides?.model ?? ctx.profile.manifest.ai.default_model,
              ruleParserOutput,
              config: { llm: { mode: llmMode } },
            }
          : {}),
      });

      if (result.endpoints) allEndpoints = [...allEndpoints, ...result.endpoints];
      if (result.pages) allPages = [...allPages, ...result.pages];
      if (result.events) allEvents = [...allEvents, ...result.events];

      for (const w of result.warnings) {
        warnings.push(w);
        yield { type: "warning", message: w };
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      warnings.push(`Parser ${plugin.id} failed: ${error.message}`);
      yield { type: "warning", message: `Parser ${plugin.id} failed: ${error.message}` };
    }
  }

  emit(`  ${allEndpoints.length} endpoints, ${allPages.length} pages, ${allEvents.length} events`);

  // --- 3. Build fresh items ---
  const freshItems = new Map<string, SpecItem>();

  for (const s of allEndpoints) {
    const item = buildBackendItem(s, rootDir);
    freshItems.set(item.id, item);
  }
  for (const s of allPages) {
    const item = buildFrontendItem(s, rootDir);
    freshItems.set(item.id, item);
  }
  for (const s of allEvents) {
    const item = buildEventItem(s, rootDir);
    freshItems.set(item.id, item);
  }

  // --- 4. Read existing spec ---
  emit("Reading existing spec…");
  yield { type: "progress", message: "Reading existing spec" };
  const existingSpec = await spec.read();
  const existingItems: Record<string, SpecItem> = existingSpec?.items ?? {};

  // --- 5. Merge items ---
  emit("Merging items…");
  yield { type: "progress", message: "Merging items" };
  const mergedItems: Record<string, SpecItem> = {};

  for (const [id, fresh] of freshItems) {
    const existing = existingItems[id];

    if (!existing) {
      // New item
      mergedItems[id] = fresh;
      itemsCreated++;
    } else if ((existing as BackendSpecItem).sourceHash === (fresh as BackendSpecItem).sourceHash) {
      // Unchanged — keep existing, refresh sourceHash for forward-compat
      mergedItems[id] = {
        ...(existing as SpecItem),
        sourceHash: (fresh as BackendSpecItem).sourceHash,
      };
    } else {
      // Changed — merge parser structure with existing human edits
      const freshRec = fresh as unknown as Record<string, unknown>;
      const existingRec = existing as unknown as Record<string, unknown>;
      const merged = mergeSpec(freshRec, existingRec);

      mergedItems[id] = {
        ...(merged as unknown as SpecItem),
        sourceHash: (fresh as BackendSpecItem).sourceHash,
      };
      itemsUpdated++;
    }

    yield { type: "item-updated", itemId: id };
  }

  // Items in existing but not in fresh → drop them from the spec and disk.
  for (const id of Object.keys(existingItems)) {
    if (!freshItems.has(id)) {
      await spec.deleteItem(id);
      itemsRemoved++;
    }
  }

  // --- 6. Build tree ---
  emit("Building tree…");
  yield { type: "progress", message: "Building tree" };

  const freshItemIds = new Set(freshItems.keys());
  const allItemIds = new Set(Object.keys(mergedItems));

  let tree: TreeNode[];
  if (existingSpec) {
    tree = updateExistingTree(existingSpec.tree, freshItemIds, allItemIds);
  } else {
    tree = buildDefaultTree(allEndpoints, allPages, allEvents);
  }

  // --- 7. AI enrichment ---
  // NOTE: yield cannot be called inside async callbacks. Each parallel task
  // pushes events into a shared buffer; the outer loop drains it as tasks
  // complete, so progress streams live to SSE clients.
  const aiCalls: GeneratorAiCallSummary[] = [];

  const fullTreeOpts = (ctx.options ?? {}) as FullTreeSpecOpts;
  const mode: EnrichmentMode = fullTreeOpts.mode ?? "initial";
  const targetItemId = fullTreeOpts.targetItemId;
  const force = fullTreeOpts.force === true;
  const onlyIds = Array.isArray(fullTreeOpts.itemIds) ? new Set(fullTreeOpts.itemIds) : null;

  // Source directory for readSourceCode. Only set when the caller provides an
  // on-disk source root (local CLI / local projects). For GitHub-source
  // projects ctx.sourceRootDir is undefined and we skip disk reads entirely —
  // falling back to ctx.rootDir would be GitHubFs's "/" sentinel and cause
  // statSync against the host filesystem.
  const sourceRootDir =
    typeof ctx.sourceRootDir === "string" && ctx.sourceRootDir.length > 0
      ? ctx.sourceRootDir
      : null;

  const itemsNeedingAi = Object.values(mergedItems).filter((item) => {
    if (onlyIds && !onlyIds.has(item.id)) return false;
    return shouldEnrich(item as unknown as Record<string, unknown>, mode, targetItemId, force);
  });

  if (onlyIds) {
    yield {
      type: "progress",
      message: `Filtering AI enrichment to ${onlyIds.size} requested item(s); ${itemsNeedingAi.length} match + need AI`,
    };
  }
  if (mode !== "initial") {
    yield {
      type: "progress",
      message: `Enrichment mode: ${mode}${targetItemId ? ` (target=${targetItemId})` : ""}; ${itemsNeedingAi.length} item(s) selected`,
    };
  }

  if (itemsNeedingAi.length > 0) {
    const concurrency =
      ctx.aiOverrides?.concurrency ?? ctx.profile.manifest.ai.default_concurrency ?? 3;
    const provider = ai.primaryProvider;
    const model = ctx.aiOverrides?.model ?? ctx.profile.manifest.ai.default_model;
    const temperature = ctx.aiOverrides?.temperature ?? ctx.profile.manifest.ai.default_temperature;
    const maxTokens = ctx.aiOverrides?.maxTokens ?? ctx.profile.manifest.ai.default_max_tokens;
    const aiTotal = itemsNeedingAi.length;

    yield {
      type: "progress",
      message: `AI: enriching ${aiTotal} item(s) via ${provider}/${model} (concurrency=${concurrency})`,
    };

    const queue = new PQueue({ concurrency });
    const eventBuffer: GeneratorEvent[] = [];
    let aiCompleted = 0;
    let runningCost = 0;

    // Circuit breaker: stop the AI loop after N consecutive failures so a
    // broken auth / rate-limited provider doesn't burn through every item.
    // Reset to 0 on each success.
    const CIRCUIT_BREAK_THRESHOLD = 3;
    let consecutiveFailures = 0;
    let circuitOpen = false;

    const formatStatus = (
      n: number,
      itemId: string,
      ms: number,
      cost: number,
      ok: boolean,
      detail?: string,
    ): string => {
      const pct = Math.round((n / aiTotal) * 100);
      const mark = ok ? "✓" : "✗";
      const costStr = cost > 0 ? ` · $${cost.toFixed(4)}` : "";
      const totalStr = runningCost > 0 ? ` · total $${runningCost.toFixed(4)}` : "";
      const detailStr = detail ? ` — ${detail}` : "";
      return `AI ${n}/${aiTotal} (${pct}%) ${mark} ${itemId} · ${ms}ms${costStr}${totalStr}${detailStr}`;
    };

    const tasks = itemsNeedingAi.map((item) =>
      queue.add(async () => {
        // Circuit breaker open — skip remaining tasks. This catches items
        // already queued before the breaker opened.
        if (circuitOpen) {
          aiCompleted++;
          eventBuffer.push({
            type: "progress",
            message: formatStatus(aiCompleted, item.id, 0, 0, false, "skipped (circuit open)"),
          });
          return;
        }

        const itemRec = item as unknown as Record<string, unknown>;
        const sourceFiles = Array.isArray(itemRec.sourceFiles)
          ? (itemRec.sourceFiles as string[])
          : [];
        const sourceCode = sourceRootDir ? readSourceCode(sourceFiles, sourceRootDir) : "";
        const { system, user } = await renderPrompt({
          profile: ctx.profile,
          itemType: canonicalItemType(item.type),
          guidelines: guidelines ?? "",
          variables: { item: stripTodoFields(itemRec), sourceCode },
        });

        const t0 = Date.now();
        let usage = {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        };
        let cost = 0;

        try {
          const result = await ai.complete({
            prompt: user,
            system,
            model,
            temperature,
            maxTokens,
            signal: ctx.signal,
          });
          usage = result.usage;
          const durationMs = Date.now() - t0;
          cost = calcCost(
            provider,
            model,
            usage.input_tokens,
            usage.output_tokens,
            usage.cache_read_tokens,
            usage.cache_write_tokens,
          );

          const parsed = safeParseJson(result.text);
          if (!parsed) {
            aiCompleted++;
            runningCost += cost;
            const preview = (result.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
            const previewSuffix = preview ? ` · raw: ${preview}` : "";
            const msg = `AI output for ${item.id} was not parseable JSON; leaving placeholders${previewSuffix}`;
            warnings.push(msg);
            aiCalls.push({
              itemId: item.id,
              provider,
              model,
              durationMs,
              costUsd: cost,
              usage,
              status: "json_parse_failed",
              error: `AI response was not valid JSON${previewSuffix}`,
            });
            eventBuffer.push({
              type: "progress",
              message: formatStatus(
                aiCompleted,
                item.id,
                durationMs,
                cost,
                false,
                "JSON parse failed",
              ),
            });
            eventBuffer.push({ type: "warning", message: msg });
            return;
          }

          const schema = schemaForItemType(item.type);
          if (schema) {
            const validated = schema.safeParse(parsed);
            if (!validated.success) {
              aiCompleted++;
              runningCost += cost;
              const errMsg = validated.error.message.slice(0, 500);
              const msg = `AI output for ${item.id} failed schema validation: ${errMsg}`;
              warnings.push(msg);
              aiCalls.push({
                itemId: item.id,
                provider,
                model,
                durationMs,
                costUsd: cost,
                usage,
                status: "schema_invalid",
                error: errMsg,
              });
              eventBuffer.push({
                type: "progress",
                message: formatStatus(
                  aiCompleted,
                  item.id,
                  durationMs,
                  cost,
                  false,
                  "schema invalid",
                ),
              });
              eventBuffer.push({ type: "warning", message: msg });
              return;
            }
            mergeAiEnrichment(itemRec, validated.data as Record<string, unknown>);
          } else {
            // Unknown item type — accept the raw object (forward-compat)
            mergeAiEnrichment(itemRec, parsed as Record<string, unknown>);
          }

          // Mark the enrichment as fresh against the current source. Drift
          // detector compares sourceHash vs enrichedSourceHash on later runs.
          // Only set on the success path (after schema validation passes) —
          // never on json_parse_failed / schema_invalid / provider_error.
          if (typeof itemRec.sourceHash === "string") {
            itemRec.enrichedSourceHash = itemRec.sourceHash;
          }
          // Mirror for capture drift. Set even when captureHash is undefined
          // (clears any stale enrichedCaptureHash from a previous capture
          // that's since been wiped), so the gate stays consistent.
          itemRec.enrichedCaptureHash = itemRec.captureHash;

          // Drop the stored Tiptap blocks ONLY on the explicit force path
          // (the user clicked "Rebuild"). On automatic drift-driven runs
          // (Update / change-detect mode) we keep hand-edited blocks —
          // silently wiping them on every code change is too destructive.
          // The cost: drift-driven runs refresh the structured fields but
          // the rendered page stays on the cached layout.
          if (force) {
            itemRec.blocks = undefined;
          }

          aiCompleted++;
          runningCost += cost;
          aiCalls.push({
            itemId: item.id,
            provider,
            model,
            durationMs,
            costUsd: cost,
            usage,
            status: "ok",
          });
          eventBuffer.push({
            type: "progress",
            message: formatStatus(aiCompleted, item.id, durationMs, cost, true),
          });
          eventBuffer.push({ type: "item-updated", itemId: item.id });
          consecutiveFailures = 0;
        } catch (err) {
          const durationMs = Date.now() - t0;
          aiCompleted++;
          const errMsg = (err as Error).message.slice(0, 500);
          const msg = `AI call failed for ${item.id}: ${errMsg}`;
          warnings.push(msg);
          aiCalls.push({
            itemId: item.id,
            provider,
            model,
            durationMs,
            costUsd: 0,
            usage,
            status: "provider_error",
            error: errMsg,
          });
          eventBuffer.push({
            type: "progress",
            message: formatStatus(aiCompleted, item.id, durationMs, 0, false, errMsg.slice(0, 80)),
          });
          eventBuffer.push({ type: "warning", message: msg });

          consecutiveFailures++;
          if (consecutiveFailures >= CIRCUIT_BREAK_THRESHOLD && !circuitOpen) {
            circuitOpen = true;
            queue.clear();
            const tripMsg = `AI circuit breaker tripped after ${CIRCUIT_BREAK_THRESHOLD} consecutive failures (last error: ${errMsg.slice(0, 200)}). Skipping remaining items.`;
            eventBuffer.push({ type: "warning", message: tripMsg });
            warnings.push(tripMsg);
          }
        }
      }),
    );

    // Drain the event buffer concurrently with task execution. Each iteration
    // either yields a buffered event or sleeps briefly until more arrive.
    let finished = false;
    Promise.all(tasks)
      .then(() => {
        finished = true;
      })
      .catch(() => {
        finished = true;
      });

    while (!finished || eventBuffer.length > 0) {
      if (eventBuffer.length > 0) {
        yield eventBuffer.shift()!;
        // Yield event-loop control so p-queue tasks can dispatch + microtasks resolve
        await new Promise((resolve) => setImmediate(resolve));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }

    // Surface any rejection from the queue
    await Promise.all(tasks);

    yield {
      type: "progress",
      message: `AI: done — ${aiCompleted}/${aiTotal} processed · total $${runningCost.toFixed(4)}`,
    };
  }

  const aiCostUsdTotal = aiCalls.reduce((sum, call) => sum + call.costUsd, 0);

  // --- 8. Build meta ---
  const now = new Date();
  const meta: SpecMeta = {
    target: path.basename(rootDir),
    version: versionString(now),
    generatedAt: now.toISOString(),
    lastRun: {
      at: now.toISOString(),
      changed: itemsUpdated,
      added: itemsCreated,
      unchanged: Object.keys(mergedItems).length - itemsCreated - itemsUpdated - itemsRemoved,
    },
  };

  // Carry over existing meta fields (e.g. backendDir, frontendDir) if present
  if (existingSpec?.meta) {
    Object.assign(meta, { ...existingSpec.meta, ...meta });
  }

  // --- 8. Write spec ---
  // spec.json holds meta + tree + item stubs (id/type/title only).
  // Each full item is written to items/<id>.json so the spec route + PATCH
  // version history can read/write them per-item.
  emit("Writing spec…");
  yield { type: "progress", message: "Writing spec" };
  const stubs: Record<string, SpecItem> = {};
  for (const [id, item] of Object.entries(mergedItems)) {
    stubs[id] = { id: item.id, type: item.type, title: item.title } as SpecItem;
    await spec.writeItem(item);
  }
  const finalSpec: Spec = { meta, tree, items: stubs };
  await spec.write(finalSpec);

  emit(
    `Done — ${itemsCreated} created, ${itemsUpdated} updated, ${itemsRemoved} stale, ${warnings.length} warnings, ${aiCalls.length} AI calls ($${aiCostUsdTotal.toFixed(4)})`,
  );
  yield {
    type: "done",
    stats: {
      itemsCreated,
      itemsUpdated,
      itemsRemoved,
      warnings: warnings.length,
      aiCalls,
      aiCostUsdTotal,
    },
  };
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export const fullTreeSpecGenerator: GeneratorPlugin = {
  id: "full-tree-spec",
  name: "Full Tree Spec",
  description:
    "Generates a complete spec.json from all detected parsers. Ports the legacy specgen/index.ts pipeline.",
  supports_profiles: "*",
  supports_parsers: "*",
  produces_item_types: ["backend", "frontend", "event", "handler"],
  run,
};
