import type { Project } from "../types/Project.js";

/**
 * Generators that require an AI provider to do anything useful.
 *
 * `frontend-capture` is intentionally NOT in this list — it just navigates
 * Playwright and stores screenshots, no model calls. Any future pure-data
 * generators should likewise stay out of this list.
 */
const AI_REQUIRING_GENERATORS = new Set([
  "full-tree-spec",
  "enrichment-pipeline",
  "enrich-items",
  "project-bootstrap",
  "smart-tree",
]);

export function generatorRequiresAi(generatorId: string): boolean {
  return AI_REQUIRING_GENERATORS.has(generatorId);
}

/**
 * A project's AI config is "usable" when it has a provider set and it
 * isn't the deterministic local stub. The stub emits `stub output for
 * prompt...` which fails JSON parse on every item — so a project pinned
 * to it is no better than no provider at all.
 */
export function isAiConfigured(project: Pick<Project, "ai">): boolean {
  const provider = (project.ai as { provider?: string } | undefined)?.provider;
  return Boolean(provider) && provider !== "local";
}
