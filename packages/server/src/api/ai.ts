import {
  ClaudeApiClient,
  ClaudeCodeClient,
  JsonSpecRepository,
  OllamaClient,
  OpenAIClient,
  ProfileLoader,
  calcCost,
  canonicalItemType,
  renderPrompt,
} from "@specgen/core";
import { Router } from "express";
import { httpError } from "../middleware/errorHandler.js";
import { validateSlug } from "../middleware/validateSlug.js";
import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import { buildAiRouter } from "../services/aiClientFactory.js";
import { isAiConfigured } from "../services/aiUsable.js";
import { probeClaudeCode } from "../services/claudeCodeDetector.js";
import { getProjectDataDir } from "../services/projectDataDir.js";

export interface AiRouterDeps {
  projects: SqliteProjectRepository;
  packagedProfilesDir: string;
}

interface ProviderModel {
  id: string;
  displayName: string;
  costPer1MIn?: number;
  costPer1MOut?: number;
}

interface ProviderInfo {
  id: string;
  name: string;
  configured: boolean;
  subscriptionBased: boolean;
  requiresBaseUrl?: boolean;
  /**
   * Optional human-readable detail. When the provider is partially configured
   * (e.g. claude CLI installed but no OAuth token), this carries the actionable
   * next step so the UI can hint specifically.
   */
  hint?: string;
  models: ProviderModel[];
}

function modelsOf(client: {
  models: ReadonlyArray<{
    id: string;
    displayName: string;
    costPer1MIn?: number;
    costPer1MOut?: number;
  }>;
}): ProviderModel[] {
  return client.models.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    costPer1MIn: m.costPer1MIn,
    costPer1MOut: m.costPer1MOut,
  }));
}

/**
 * GET /api/ai/providers — server-wide provider availability + model lists.
 * Mounted at /api/ai (no project slug).
 */
export function aiProvidersRouter(): Router {
  const r = Router();

  r.get("/providers", async (_req, res) => {
    const claudeCode = await probeClaudeCode();
    const claudeCodeHint = claudeCode.ready
      ? "CLI installed + OAuth token set"
      : !claudeCode.onPath
        ? "install the `claude` CLI to enable"
        : "set CLAUDE_CODE_OAUTH_TOKEN to enable (run `claude setup-token` on a logged-in machine)";
    const list: ProviderInfo[] = [
      {
        id: "claude_code",
        name: "Claude Code (CLI subscription)",
        configured: claudeCode.ready,
        subscriptionBased: true,
        hint: claudeCodeHint,
        models: modelsOf(new ClaudeCodeClient()),
      },
      {
        id: "claude_api",
        name: "Anthropic API",
        configured: Boolean(process.env.ANTHROPIC_API_KEY),
        subscriptionBased: false,
        models: modelsOf(new ClaudeApiClient({ apiKey: "stub" })),
      },
      {
        id: "openai",
        name: "OpenAI",
        configured: Boolean(process.env.OPENAI_API_KEY),
        subscriptionBased: false,
        models: modelsOf(new OpenAIClient({ apiKey: "stub" })),
      },
      {
        id: "openai_compat",
        name: "OpenAI-compatible",
        configured: false,
        subscriptionBased: false,
        requiresBaseUrl: true,
        models: modelsOf(new OpenAIClient({ apiKey: "stub", providerId: "openai_compat" })),
      },
      {
        id: "ollama",
        name: "Ollama (local)",
        configured: true,
        subscriptionBased: true,
        models: modelsOf(new OllamaClient()),
      },
      {
        id: "local",
        name: "Local stub (deterministic)",
        configured: true,
        subscriptionBased: true,
        models: [{ id: "stub", displayName: "Local stub" }],
      },
    ];
    res.json(list);
  });

  return r;
}

/**
 * POST /api/projects/:slug/ai/test — run AI against one item or a free-form prompt.
 * Mounted at /api/projects (uses project slug from path).
 */
export function projectAiRouter(deps: AiRouterDeps): Router {
  const r = Router({ mergeParams: true });

  r.post("/:slug/ai/test", validateSlug("slug"), async (req, res, next) => {
    try {
      const slug = req.params.slug as string;
      const project = deps.projects.findBySlug(slug);
      if (!project) return next(httpError(404, "Project not found"));

      const body = req.body as { itemId?: string; prompt?: string };
      if (!body.itemId && !body.prompt) {
        return next(httpError(400, "Either itemId or prompt is required"));
      }

      // No-AI gate — same shape as the run enqueue gate so the webapp can
      // share error-handling code.
      if (!isAiConfigured(project)) {
        res.status(400).json({
          error: "AI provider not configured",
          hint: "Open Project → Settings → AI and pick a provider.",
        });
        return;
      }

      const ai = (project.ai as Record<string, unknown> | undefined) ?? {};
      const profileId = (ai.profileId as string) ?? "pm-spec";
      const provider = (ai.provider as string) ?? "local";
      const model = (ai.model as string) ?? "stub";

      const profileLoader = new ProfileLoader({ packagedRoot: deps.packagedProfilesDir });
      const projectRoot = project.source.type === "local" ? project.source.localPath : undefined;
      const profile = await profileLoader.load(profileId, projectRoot);

      // Render prompt: use provided prompt verbatim or render from profile + item.
      // Free-form prompts have no system framing; profile renders return split
      // { system, user } per Task 1's renderPrompt contract.
      let promptText: string;
      let systemText: string | undefined;
      if (body.prompt) {
        promptText = body.prompt;
      } else {
        const dataDir = getProjectDataDir(project);
        const repo = new JsonSpecRepository(dataDir);
        const item = await repo.readItem(body.itemId as string);
        if (!item) return next(httpError(404, `Item ${body.itemId} not found`));
        const { system, user } = await renderPrompt({
          profile,
          itemType: canonicalItemType(item.type),
          guidelines: (ai.guidelines as string) ?? "",
          variables: { item: item as unknown as Record<string, unknown> },
        });
        promptText = user;
        systemText = system;
      }

      const router = buildAiRouter(ai);

      const t0 = Date.now();
      const result = await router.complete({
        prompt: promptText,
        system: systemText,
        model,
        temperature: (ai.temperature as number) ?? 0.2,
        maxTokens: (ai.maxTokens as number) ?? 4000,
      });
      const durationMs = Date.now() - t0;
      const costUsd = calcCost(
        provider,
        model,
        result.usage.input_tokens,
        result.usage.output_tokens,
        result.usage.cache_read_tokens,
        result.usage.cache_write_tokens,
      );

      res.json({
        provider,
        model,
        durationMs,
        costUsd,
        promptText,
        systemText,
        output: result.text,
        usage: result.usage,
      });
    } catch (err) {
      next(err);
    }
  });

  return r;
}
