/**
 * enrichment-pipeline — Meta-generator that orchestrates the three AI passes
 * over a project's spec:
 *
 *   1. project-bootstrap   — one-shot AI summary of the project's purpose
 *   2. full-tree-spec      — parser + AI enrichment for each spec item
 *   3. smart-tree          — AI-proposed sidebar tree reorganisation
 *
 * The stages are mode-aware:
 *
 *   mode = "initial"        bootstrap → full-tree → smart-tree   (all three)
 *   mode = "change-detect"  full-tree (drift-aware) [+ smart-tree iff item set changed]
 *   mode = "single"         full-tree only, targeting `targetItemId`
 *
 * `forceBootstrap` overrides the "bootstrap only on initial" rule (useful when
 * the caller wants to refresh meta.bootstrap without doing a full re-parse).
 *
 * The orchestrator forwards every progress / warning / item-updated event from
 * its sub-generators, swallows the per-stage `done` events, and emits a single
 * aggregated `done` at the end. Errors from any stage are forwarded but do not
 * halt later stages — each sub-generator is responsible for its own cleanup.
 */

import type { SpecRepository } from "../../spec/SpecRepository.js";
import type {
  GeneratorAiCallSummary,
  GeneratorContext,
  GeneratorEvent,
  GeneratorPlugin,
} from "../Generator.js";
import { type EnrichmentMode, fullTreeSpecGenerator } from "./full-tree-spec.js";
import { projectBootstrapGenerator } from "./project-bootstrap.js";
import { smartTreeGenerator } from "./smart-tree.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface EnrichmentPipelineOpts {
  /** Enrichment mode forwarded to full-tree-spec. Defaults to "initial". */
  mode?: EnrichmentMode;
  /** Required when mode === "single". Forwarded to full-tree-spec. */
  targetItemId?: string;
  /** Run the bootstrap stage even when mode !== "initial". */
  forceBootstrap?: boolean;
  /**
   * Force re-enrichment of every item via full-tree-spec, bypassing the drift
   * / TODO gate. Forwarded as `force` on full-tree-spec options. Used by the
   * "Rebuild" action.
   */
  force?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Snapshot the set of item ids currently in the spec repository. */
async function snapshotItemIds(repo: SpecRepository): Promise<Set<string>> {
  try {
    const ids = await repo.listItemIds();
    return new Set(ids);
  } catch {
    // No items dir yet (first run) — treat as empty set.
    return new Set();
  }
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) {
    if (!b.has(v)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const enrichmentPipelineGenerator: GeneratorPlugin = {
  id: "enrichment-pipeline",
  name: "AI enrichment pipeline",
  description:
    "Runs project-bootstrap, full-tree-spec, and smart-tree in sequence, with mode-aware skipping of bootstrap and smart-tree stages.",
  supports_profiles: "*",
  supports_parsers: "*",
  produces_item_types: ["backend", "frontend", "event", "handler"],

  async *run(ctx: GeneratorContext): AsyncIterable<GeneratorEvent> {
    const opts = (ctx.options ?? {}) as EnrichmentPipelineOpts;
    const mode: EnrichmentMode = opts.mode ?? "initial";

    // Accumulators for the final aggregated `done` event.
    let itemsCreated = 0;
    let itemsUpdated = 0;
    let itemsRemoved = 0;
    let warnings = 0;
    const aiCalls: GeneratorAiCallSummary[] = [];
    let aiCostUsdTotal = 0;

    /**
     * Run a sub-generator and forward its events, but suppress its terminal
     * `done` event — the orchestrator emits one aggregated `done` of its own.
     * Stats from each sub-`done` are folded into the accumulators above.
     */
    async function* runSub(sub: AsyncIterable<GeneratorEvent>): AsyncIterable<GeneratorEvent> {
      for await (const ev of sub) {
        if (ev.type === "done") {
          itemsCreated += ev.stats.itemsCreated;
          itemsUpdated += ev.stats.itemsUpdated;
          itemsRemoved += ev.stats.itemsRemoved;
          warnings += ev.stats.warnings;
          for (const call of ev.stats.aiCalls) aiCalls.push(call);
          aiCostUsdTotal += ev.stats.aiCostUsdTotal;
          continue; // suppress
        }
        yield ev;
      }
    }

    // -------------------------------------------------------------------
    // Stage A — project-bootstrap (only on `initial` or when forced)
    // -------------------------------------------------------------------
    if (mode === "initial" || opts.forceBootstrap) {
      yield {
        type: "progress",
        message: "[pipeline] stage 1/3 — project-bootstrap",
      };
      yield* runSub(projectBootstrapGenerator.run(ctx));
    } else {
      yield {
        type: "progress",
        message: `[pipeline] stage 1/3 — project-bootstrap skipped (mode=${mode})`,
      };
    }

    // -------------------------------------------------------------------
    // Snapshot item ids BEFORE full-tree-spec writes new ones.
    // smart-tree's gating decision (on change-detect) compares against the
    // post-full-tree-spec snapshot to detect additions/removals.
    // -------------------------------------------------------------------
    const idsBefore = await snapshotItemIds(ctx.spec);

    // -------------------------------------------------------------------
    // Stage B — full-tree-spec (always runs; forward mode + targetItemId)
    // -------------------------------------------------------------------
    yield { type: "progress", message: "[pipeline] stage 2/3 — full-tree-spec" };
    const fullTreeCtx: GeneratorContext = {
      ...ctx,
      options: {
        ...(ctx.options ?? {}),
        mode,
        targetItemId: opts.targetItemId,
        force: opts.force,
      },
    };
    yield* runSub(fullTreeSpecGenerator.run(fullTreeCtx));

    const idsAfter = await snapshotItemIds(ctx.spec);

    // -------------------------------------------------------------------
    // Stage C — smart-tree
    //   initial:       always run
    //   change-detect: only if the item set changed
    //   single:        never run
    // -------------------------------------------------------------------
    const setChanged = !setsEqual(idsBefore, idsAfter);
    const shouldRunSmartTree = mode === "initial" || (mode === "change-detect" && setChanged);

    if (shouldRunSmartTree) {
      yield { type: "progress", message: "[pipeline] stage 3/3 — smart-tree" };
      yield* runSub(smartTreeGenerator.run(ctx));
    } else {
      const reason =
        mode === "single"
          ? "single-item mode"
          : mode === "change-detect"
            ? "item set unchanged"
            : `mode=${mode}`;
      yield {
        type: "progress",
        message: `[pipeline] stage 3/3 — smart-tree skipped (${reason})`,
      };
    }

    // -------------------------------------------------------------------
    // Aggregated done
    // -------------------------------------------------------------------
    yield {
      type: "done",
      stats: {
        itemsCreated,
        itemsUpdated,
        itemsRemoved,
        warnings,
        aiCalls,
        aiCostUsdTotal,
      },
    };
  },
};
