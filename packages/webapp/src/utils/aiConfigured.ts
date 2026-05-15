import type { Project } from "@specgen/server";

/**
 * A project has a usable AI provider configured when:
 *  - `ai.provider` is set to a non-empty string, and
 *  - it isn't the deterministic local stub (which only produces
 *    "stub output for prompt..." and fails JSON parsing in real runs).
 *
 * Used by the dashboard / project shell badges and the run buttons to
 * decide whether to surface the "configure AI" warning instead of
 * letting users blow a full run cycle into an unusable result.
 */
export function aiConfigured(project: Pick<Project, "ai"> | null | undefined): boolean {
  if (!project) return false;
  const ai = (project.ai as { provider?: string } | undefined) ?? {};
  const provider = ai.provider;
  return Boolean(provider) && provider !== "local";
}
