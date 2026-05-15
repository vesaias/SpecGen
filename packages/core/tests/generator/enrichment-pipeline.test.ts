/**
 * Tests for enrichment-pipeline orchestrator.
 *
 * Strategy: spy on each sub-generator's `.run` and replace with a stub async
 * generator that records its options and yields a controllable `done` event.
 * The orchestrator's choices about which sub-generators to invoke (and what
 * options to pass) are what we verify here — we deliberately do NOT exercise
 * the sub-generators' real AI / IO logic; that's covered by their own tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  GeneratorContext,
  GeneratorEvent,
  GeneratorPlugin,
} from "../../src/generator/Generator.js";
import { enrichmentPipelineGenerator } from "../../src/generator/builtins/enrichment-pipeline.js";
import * as fullTreeMod from "../../src/generator/builtins/full-tree-spec.js";
import * as bootstrapMod from "../../src/generator/builtins/project-bootstrap.js";
import * as smartTreeMod from "../../src/generator/builtins/smart-tree.js";
import type { SpecRepository, SpecSnapshot } from "../../src/spec/SpecRepository.js";
import type { Spec, SpecItem } from "../../src/spec/types.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Programmable spec repo: listItemIds returns from a queue (one per call). */
function makeSpecRepo(listItemIdsResults: string[][]): SpecRepository {
  const queue = [...listItemIdsResults];
  return {
    async read(): Promise<Spec | null> {
      return null;
    },
    async write(_spec: Spec): Promise<void> {},
    async readItem(_id: string): Promise<SpecItem | null> {
      return null;
    },
    async writeItem(_item: SpecItem): Promise<void> {},
    async deleteItem(_id: string): Promise<void> {},
    async listItemIds(): Promise<string[]> {
      if (queue.length === 0) return [];
      return queue.shift() ?? [];
    },
    async snapshot(): Promise<SpecSnapshot> {
      throw new Error("not used");
    },
  };
}

function makeCtx(spec: SpecRepository, options?: Record<string, unknown>): GeneratorContext {
  // Most fields are unused by the orchestrator itself (only forwarded to sub
  // generators, which we stub out). We cast through unknown to keep the fake
  // small — anything the orchestrator touches directly is set explicitly.
  return {
    rootDir: "/tmp/fake",
    spec,
    options,
  } as any;
}

/**
 * Build a stub `.run` that:
 *   - records the ctx.options it was called with (in `callLog`)
 *   - appends its label to `order` so we can assert invocation sequence
 *   - yields a single `done` event
 */
function makeStubRun(
  label: string,
  order: string[],
  callLog: Array<{ label: string; options: Record<string, unknown> | undefined }>,
): GeneratorPlugin["run"] {
  return async function* (ctx: GeneratorContext): AsyncIterable<GeneratorEvent> {
    order.push(label);
    callLog.push({ label, options: ctx.options });
    yield {
      type: "done" as const,
      stats: {
        itemsCreated: 0,
        itemsUpdated: 0,
        itemsRemoved: 0,
        warnings: 0,
        aiCalls: [],
        aiCostUsdTotal: 0,
      },
    };
  };
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let order: string[];
let callLog: Array<{ label: string; options: Record<string, unknown> | undefined }>;
let bootstrapSpy: ReturnType<typeof vi.spyOn>;
let fullTreeSpy: ReturnType<typeof vi.spyOn>;
let smartTreeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  order = [];
  callLog = [];
  bootstrapSpy = vi
    .spyOn(bootstrapMod.projectBootstrapGenerator, "run")
    .mockImplementation(makeStubRun("bootstrap", order, callLog));
  fullTreeSpy = vi
    .spyOn(fullTreeMod.fullTreeSpecGenerator, "run")
    .mockImplementation(makeStubRun("full-tree", order, callLog));
  smartTreeSpy = vi
    .spyOn(smartTreeMod.smartTreeGenerator, "run")
    .mockImplementation(makeStubRun("smart-tree", order, callLog));
});

afterEach(() => {
  bootstrapSpy.mockRestore();
  fullTreeSpy.mockRestore();
  smartTreeSpy.mockRestore();
});

async function drain(ctx: GeneratorContext): Promise<GeneratorEvent[]> {
  const evs: GeneratorEvent[] = [];
  for await (const e of enrichmentPipelineGenerator.run(ctx)) evs.push(e);
  return evs;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("enrichmentPipelineGenerator", () => {
  it("mode=initial → bootstrap → full-tree → smart-tree (in order)", async () => {
    const repo = makeSpecRepo([[], []]); // unchanged set, but smart-tree runs anyway
    const events = await drain(makeCtx(repo, { mode: "initial" }));

    expect(order).toEqual(["bootstrap", "full-tree", "smart-tree"]);
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
    expect(fullTreeSpy).toHaveBeenCalledTimes(1);
    expect(smartTreeSpy).toHaveBeenCalledTimes(1);

    // Last event is the aggregated done
    const last = events.at(-1);
    expect(last?.type).toBe("done");
  });

  it("mode=change-detect, item set unchanged → only full-tree runs", async () => {
    // Same set before and after full-tree-spec
    const repo = makeSpecRepo([
      ["a", "b"],
      ["a", "b"],
    ]);
    await drain(makeCtx(repo, { mode: "change-detect" }));

    expect(order).toEqual(["full-tree"]);
    expect(bootstrapSpy).not.toHaveBeenCalled();
    expect(fullTreeSpy).toHaveBeenCalledTimes(1);
    expect(smartTreeSpy).not.toHaveBeenCalled();
  });

  it("mode=change-detect, item set changed → full-tree + smart-tree run", async () => {
    // Item "c" was added between snapshots
    const repo = makeSpecRepo([
      ["a", "b"],
      ["a", "b", "c"],
    ]);
    await drain(makeCtx(repo, { mode: "change-detect" }));

    expect(order).toEqual(["full-tree", "smart-tree"]);
    expect(bootstrapSpy).not.toHaveBeenCalled();
  });

  it("mode=change-detect, item removed → full-tree + smart-tree run", async () => {
    // Detect removals too, not just additions
    const repo = makeSpecRepo([
      ["a", "b", "c"],
      ["a", "b"],
    ]);
    await drain(makeCtx(repo, { mode: "change-detect" }));

    expect(order).toEqual(["full-tree", "smart-tree"]);
  });

  it("mode=single → only full-tree runs; targetItemId forwarded", async () => {
    const repo = makeSpecRepo([
      ["a", "b"],
      ["a", "b"],
    ]);
    await drain(makeCtx(repo, { mode: "single", targetItemId: "x" }));

    expect(order).toEqual(["full-tree"]);
    expect(bootstrapSpy).not.toHaveBeenCalled();
    expect(smartTreeSpy).not.toHaveBeenCalled();

    const fullTreeCall = callLog.find((c) => c.label === "full-tree");
    expect(fullTreeCall?.options?.mode).toBe("single");
    expect(fullTreeCall?.options?.targetItemId).toBe("x");
  });

  it("mode=single + change in id set → still skips smart-tree", async () => {
    // single-item mode never runs smart-tree, even if the snapshot diff
    // would have triggered it on change-detect mode.
    const repo = makeSpecRepo([["a"], ["a", "b"]]);
    await drain(makeCtx(repo, { mode: "single", targetItemId: "a" }));

    expect(smartTreeSpy).not.toHaveBeenCalled();
  });

  it("force=true is forwarded to full-tree-spec via ctx.options", async () => {
    const repo = makeSpecRepo([[], []]);
    await drain(makeCtx(repo, { mode: "initial", force: true, forceBootstrap: true }));

    const fullTreeCall = callLog.find((c) => c.label === "full-tree");
    expect(fullTreeCall?.options?.force).toBe(true);
    expect(fullTreeCall?.options?.mode).toBe("initial");
  });

  it("forceBootstrap=true on mode=change-detect → bootstrap also runs", async () => {
    const repo = makeSpecRepo([["a"], ["a"]]); // unchanged → no smart-tree
    await drain(makeCtx(repo, { mode: "change-detect", forceBootstrap: true }));

    expect(order).toEqual(["bootstrap", "full-tree"]);
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
  });

  it("default mode (omitted) → behaves as initial", async () => {
    const repo = makeSpecRepo([[], []]);
    await drain(makeCtx(repo)); // no options at all

    expect(order).toEqual(["bootstrap", "full-tree", "smart-tree"]);
  });

  it("forwards mode + targetItemId to full-tree via ctx.options", async () => {
    const repo = makeSpecRepo([[], []]);
    await drain(makeCtx(repo, { mode: "change-detect", targetItemId: undefined, extra: "keep" }));

    const fullTreeCall = callLog.find((c) => c.label === "full-tree");
    expect(fullTreeCall?.options?.mode).toBe("change-detect");
    // Other caller options must survive the forward
    expect(fullTreeCall?.options?.extra).toBe("keep");
  });

  it("aggregates stats from each sub-generator into a single done event", async () => {
    // Replace stubs with ones that yield non-zero stats so we can verify the
    // accumulator math without depending on the default zero-stats stubs.
    bootstrapSpy.mockImplementation(async function* () {
      yield {
        type: "done" as const,
        stats: {
          itemsCreated: 0,
          itemsUpdated: 1,
          itemsRemoved: 0,
          warnings: 1,
          aiCalls: [
            {
              itemId: "__meta__",
              provider: "stub",
              model: "stub",
              durationMs: 10,
              costUsd: 0.01,
              usage: {
                input_tokens: 1,
                output_tokens: 1,
                cache_read_tokens: 0,
                cache_write_tokens: 0,
              },
              status: "ok",
            },
          ],
          aiCostUsdTotal: 0.01,
        },
      };
    });
    fullTreeSpy.mockImplementation(async function* () {
      yield {
        type: "done" as const,
        stats: {
          itemsCreated: 5,
          itemsUpdated: 2,
          itemsRemoved: 1,
          warnings: 0,
          aiCalls: [],
          aiCostUsdTotal: 0.5,
        },
      };
    });
    smartTreeSpy.mockImplementation(async function* () {
      yield {
        type: "done" as const,
        stats: {
          itemsCreated: 0,
          itemsUpdated: 1,
          itemsRemoved: 0,
          warnings: 0,
          aiCalls: [],
          aiCostUsdTotal: 0.02,
        },
      };
    });

    const repo = makeSpecRepo([[], []]);
    const events = await drain(makeCtx(repo, { mode: "initial" }));

    const done = events.at(-1);
    expect(done?.type).toBe("done");
    const stats = (done as any).stats;
    expect(stats.itemsCreated).toBe(5);
    expect(stats.itemsUpdated).toBe(4); // 1 + 2 + 1
    expect(stats.itemsRemoved).toBe(1);
    expect(stats.warnings).toBe(1);
    expect(stats.aiCalls).toHaveLength(1);
    expect(stats.aiCostUsdTotal).toBeCloseTo(0.53);
  });

  it("emits exactly one terminal done event", async () => {
    const repo = makeSpecRepo([[], []]);
    const events = await drain(makeCtx(repo, { mode: "initial" }));

    const dones = events.filter((e) => e.type === "done");
    expect(dones).toHaveLength(1);
  });
});
