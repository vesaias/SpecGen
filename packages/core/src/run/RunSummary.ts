import type { GeneratorAiCallSummary } from "../generator/Generator.js";

export interface RunSummary {
  itemsCreated: number;
  itemsUpdated: number;
  itemsRemoved: number;
  warnings: number;
  aiCalls: GeneratorAiCallSummary[];
  aiCostUsdTotal: number;
  /**
   * Optional: ids of items whose capture data was refreshed this run. Set by
   * `frontend-capture`; consumed by the server's `autoEnrichAfterCapture` hook
   * to chain an AI enrichment scoped to exactly these items. Empty/omitted
   * for runs that don't touch capture data.
   */
  capturedItemIds?: string[];
}

export function emptyRunSummary(): RunSummary {
  return {
    itemsCreated: 0,
    itemsUpdated: 0,
    itemsRemoved: 0,
    warnings: 0,
    aiCalls: [],
    aiCostUsdTotal: 0,
  };
}

export function mergeAiCallIntoSummary(s: RunSummary, call: GeneratorAiCallSummary): RunSummary {
  return {
    ...s,
    aiCalls: [...s.aiCalls, call],
    aiCostUsdTotal: s.aiCostUsdTotal + call.costUsd,
  };
}
