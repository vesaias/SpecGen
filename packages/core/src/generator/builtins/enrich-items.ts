/**
 * enrich-items — AI re-enrichment for a specific list of existing spec items.
 *
 * The narrow purpose: take a list of itemIds, load each from the spec, run
 * the profile's AI prompt over it, validate the response against the item's
 * output schema, and write the merged result back. NO parsing, NO tree
 * mutation, NO removals. The generator never touches items it wasn't asked
 * about.
 *
 * Use case: post-capture re-enrichment. After `frontend-capture` writes new
 * `observedSections` + `captureHash` onto an item, we want AI to re-describe
 * the page using the live browser observations — without paying the cost of
 * a full re-parse, and without risking parser non-determinism eating items
 * (which is exactly what would happen if we routed this through
 * full-tree-spec).
 *
 * Options:
 *   - itemIds: string[]  REQUIRED. Items to enrich. Anything not found in the
 *                        spec is logged as a warning and skipped.
 *   - force?:  boolean   When true, runs AI even if neither captureHash nor
 *                        sourceHash has drifted from their enriched twins.
 *                        Default false — we still skip items whose enriched
 *                        state matches the current inputs.
 */

import PQueue from "p-queue";
import { renderPrompt } from "../../ai/PromptRenderer.js";
import { mergeAiEnrichment } from "../../ai/mergeAiEnrichment.js";
import { canonicalItemType, schemaForItemType } from "../../ai/outputSchema.js";
import { calcCost } from "../../ai/pricing.js";
import { safeParseJson } from "../../ai/safeParseJson.js";
import { readSourceCode } from "../../ai/sourceCodeReader.js";
import { emptyRunSummary } from "../../run/RunSummary.js";
import { isTodoSentinel } from "../../spec/sentinels.js";
import type {
  GeneratorAiCallSummary,
  GeneratorContext,
  GeneratorEvent,
  GeneratorPlugin,
} from "../Generator.js";

export interface EnrichItemsOpts {
  itemIds: string[];
  force?: boolean;
}

function hasTodoFields(item: Record<string, unknown>): boolean {
  return Object.values(item).some((v) => isTodoSentinel(v));
}

function stripTodoFields(item: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).filter(([, v]) => !isTodoSentinel(v)));
}

/**
 * Decide whether an item is worth re-enriching. Mirrors the change-detect
 * branch of full-tree-spec.shouldEnrich, but without the mode/targetId
 * complexity — this generator is always scoped to an explicit itemIds list
 * so the only question is "do we have new input the model hasn't seen yet?"
 */
function isStale(item: Record<string, unknown>): boolean {
  if (hasTodoFields(item)) return true;
  const sourceDrift =
    typeof item.sourceHash === "string" &&
    typeof item.enrichedSourceHash === "string" &&
    item.sourceHash !== item.enrichedSourceHash;
  if (sourceDrift) return true;
  const captureDrift =
    typeof item.captureHash === "string" && item.captureHash !== item.enrichedCaptureHash;
  if (captureDrift) return true;
  return false;
}

export const enrichItemsGenerator: GeneratorPlugin = {
  id: "enrich-items",
  name: "Enrich existing items (AI only)",
  description:
    "Re-runs AI enrichment on a specified set of existing spec items. Does not re-parse the codebase or modify the tree.",
  supports_profiles: "*",
  supports_parsers: "*",
  produces_item_types: ["backend", "frontend", "event", "handler"],

  async *run(ctx: GeneratorContext): AsyncIterable<GeneratorEvent> {
    const opts = (ctx.options ?? {}) as Partial<EnrichItemsOpts>;
    const itemIds = Array.isArray(opts.itemIds) ? opts.itemIds : [];
    const force = opts.force === true;

    if (itemIds.length === 0) {
      yield {
        type: "warning",
        message: "enrich-items called with no itemIds — nothing to do",
      };
      yield { type: "done", stats: emptyRunSummary() };
      return;
    }

    // ---------------------------------------------------------------------
    // Load items
    // ---------------------------------------------------------------------
    yield {
      type: "progress",
      message: `Loading ${itemIds.length} item(s)…`,
    };

    const loaded: Array<{ id: string; item: Record<string, unknown> }> = [];
    const warnings: string[] = [];
    for (const id of itemIds) {
      const item = await ctx.spec.readItem(id);
      if (!item) {
        warnings.push(`enrich-items: item ${id} not found in spec — skipped`);
        yield {
          type: "warning",
          message: `${id} not found in spec — skipped`,
        };
        continue;
      }
      loaded.push({ id, item: item as unknown as Record<string, unknown> });
    }

    if (loaded.length === 0) {
      yield { type: "done", stats: { ...emptyRunSummary(), warnings: warnings.length } };
      return;
    }

    // ---------------------------------------------------------------------
    // Decide which need AI
    // ---------------------------------------------------------------------
    const candidates = force ? loaded : loaded.filter(({ item }) => isStale(item));
    if (candidates.length === 0) {
      yield {
        type: "progress",
        message: `All ${loaded.length} item(s) already enriched against their current inputs (no captureHash / sourceHash drift; pass force=true to override).`,
      };
      yield { type: "done", stats: { ...emptyRunSummary(), warnings: warnings.length } };
      return;
    }

    // ---------------------------------------------------------------------
    // Run AI
    // ---------------------------------------------------------------------
    const { ai, profile } = ctx;
    const provider = ai.primaryProvider;
    const model = ctx.aiOverrides?.model ?? profile.manifest.ai.default_model;
    const temperature = ctx.aiOverrides?.temperature ?? profile.manifest.ai.default_temperature;
    const maxTokens = ctx.aiOverrides?.maxTokens ?? profile.manifest.ai.default_max_tokens;
    const concurrency =
      ctx.aiOverrides?.concurrency ?? profile.manifest.ai.default_concurrency ?? 3;

    yield {
      type: "progress",
      message: `AI: enriching ${candidates.length} item(s) via ${provider}/${model} (concurrency=${concurrency})`,
    };

    const sourceRootDir =
      typeof ctx.sourceRootDir === "string" && ctx.sourceRootDir.length > 0
        ? ctx.sourceRootDir
        : null;

    const aiCalls: GeneratorAiCallSummary[] = [];
    const queue = new PQueue({ concurrency });
    const eventBuffer: GeneratorEvent[] = [];
    let aiCompleted = 0;
    let runningCost = 0;
    let updated = 0;

    // Circuit breaker: stop the AI loop after N consecutive provider failures
    // so a broken auth / rate-limited provider doesn't burn through every
    // captured item. Matches full-tree-spec.ts. Reset on each success.
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
      const pct = Math.round((n / candidates.length) * 100);
      const mark = ok ? "✓" : "✗";
      const costStr = cost > 0 ? ` · $${cost.toFixed(4)}` : "";
      const totalStr = runningCost > 0 ? ` · total $${runningCost.toFixed(4)}` : "";
      const detailStr = detail ? ` — ${detail}` : "";
      return `AI ${n}/${candidates.length} (${pct}%) ${mark} ${itemId} · ${ms}ms${costStr}${totalStr}${detailStr}`;
    };

    const tasks = candidates.map(({ id, item }) =>
      queue.add(async () => {
        // Circuit breaker open — skip remaining queued tasks. The breaker
        // is set on the catch path below; tasks already queued before it
        // tripped see this flag here and short-circuit.
        if (circuitOpen) {
          aiCompleted++;
          eventBuffer.push({
            type: "progress",
            message: formatStatus(aiCompleted, id, 0, 0, false, "skipped (circuit open)"),
          });
          return;
        }
        const itemRec = item;
        const sourceFiles = Array.isArray(itemRec.sourceFiles)
          ? (itemRec.sourceFiles as string[])
          : [];
        const sourceCode = sourceRootDir ? readSourceCode(sourceFiles, sourceRootDir) : "";
        const itemType = canonicalItemType(itemRec.type as string);
        const { system, user } = await renderPrompt({
          profile,
          itemType,
          guidelines: ctx.guidelines ?? "",
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
            const msg = `AI output for ${id} was not parseable JSON; leaving placeholders${preview ? ` · raw: ${preview}` : ""}`;
            warnings.push(msg);
            aiCalls.push({
              itemId: id,
              provider,
              model,
              durationMs,
              costUsd: cost,
              usage,
              status: "json_parse_failed",
              error: msg,
            });
            eventBuffer.push({
              type: "progress",
              message: formatStatus(aiCompleted, id, durationMs, cost, false, "JSON parse failed"),
            });
            eventBuffer.push({ type: "warning", message: msg });
            return;
          }

          const schema = schemaForItemType(itemRec.type as string);
          if (schema) {
            const validated = schema.safeParse(parsed);
            if (!validated.success) {
              aiCompleted++;
              runningCost += cost;
              const errMsg = validated.error.message.slice(0, 500);
              const msg = `AI output for ${id} failed schema validation: ${errMsg}`;
              warnings.push(msg);
              aiCalls.push({
                itemId: id,
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
                message: formatStatus(aiCompleted, id, durationMs, cost, false, "schema invalid"),
              });
              eventBuffer.push({ type: "warning", message: msg });
              return;
            }
            mergeAiEnrichment(itemRec, validated.data as Record<string, unknown>);
          } else {
            mergeAiEnrichment(itemRec, parsed as Record<string, unknown>);
          }

          // Mark the enrichment as fresh against current inputs. Drift gates
          // on the next run use these hashes to decide whether to re-enrich.
          if (typeof itemRec.sourceHash === "string") {
            itemRec.enrichedSourceHash = itemRec.sourceHash;
          }
          itemRec.enrichedCaptureHash = itemRec.captureHash;

          // Clear any saved Tiptap blocks ONLY on explicit force runs (the
          // user clicked "Re-enrich" / "Rebuild"). On automatic drift-driven
          // runs (post-capture auto-chain, source-hash drift) we keep the
          // user's hand-edits — silent block deletion on every AI write loses
          // a lot of carefully-edited prose. The downside: drift-driven runs
          // refresh the structured fields but the rendered page still shows
          // the old layout until the user explicitly re-renders.
          if (force) {
            itemRec.blocks = undefined;
          }

          // Persist the item — this is the ONLY mutation we make to the spec.
          // No tree changes, no item removals, no meta updates.
          await ctx.spec.writeItem(itemRec as unknown as Parameters<typeof ctx.spec.writeItem>[0]);

          aiCompleted++;
          runningCost += cost;
          updated++;
          aiCalls.push({
            itemId: id,
            provider,
            model,
            durationMs,
            costUsd: cost,
            usage,
            status: "ok",
          });
          eventBuffer.push({
            type: "progress",
            message: formatStatus(aiCompleted, id, durationMs, cost, true),
          });
          eventBuffer.push({ type: "item-updated", itemId: id });
          consecutiveFailures = 0;
        } catch (err) {
          const durationMs = Date.now() - t0;
          aiCompleted++;
          const errMsg = (err as Error).message.slice(0, 500);
          const msg = `AI call failed for ${id}: ${errMsg}`;
          warnings.push(msg);
          aiCalls.push({
            itemId: id,
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
            message: formatStatus(aiCompleted, id, durationMs, 0, false, errMsg.slice(0, 80)),
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

    // Drain the event buffer concurrently with task execution. Mirrors
    // full-tree-spec's drain — `queue.onEmpty()` resolves immediately when
    // `size === 0 && pending > 0`, so polling against `pending` in a tight
    // loop pegs CPU; instead, flip a `finished` flag from Promise.all and
    // sleep 25 ms between drain ticks when the buffer is empty.
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
        await new Promise((resolve) => setImmediate(resolve));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }

    // Surface any rejection from the queue
    await Promise.all(tasks);

    const aiCostUsdTotal = aiCalls.reduce((sum, c) => sum + c.costUsd, 0);
    yield {
      type: "done",
      stats: {
        itemsCreated: 0,
        itemsUpdated: updated,
        itemsRemoved: 0,
        warnings: warnings.length,
        aiCalls,
        aiCostUsdTotal,
      },
    };
  },
};
