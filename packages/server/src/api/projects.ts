import { ClaudeApiClient, ClaudeCodeClient, OpenAIClient } from "@specgen/core";
import { Router } from "express";
import { httpError } from "../middleware/errorHandler.js";
import { validateSlug } from "../middleware/validateSlug.js";
import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import { validateLocalPath } from "../services/validateLocalPath.js";

/**
 * Server-side autodetect for AI config on project create. Mirrors the
 * webapp's `autoDetectDefault` so CLI / API callers who don't pass an
 * `ai` block still end up with a usable project record instead of one
 * that falls through to the local stub provider on the first run.
 *
 * Order of preference: claude_code (subscription) → claude_api → openai → none.
 */
function autoDetectAiConfig(): Record<string, unknown> {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    const claudeCode = new ClaudeCodeClient();
    return {
      profileId: "pm-spec",
      provider: "claude_code",
      model: claudeCode.models[0]?.id ?? "",
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    const claudeApi = new ClaudeApiClient({ apiKey: "stub" });
    return {
      profileId: "pm-spec",
      provider: "claude_api",
      model: claudeApi.models[0]?.id ?? "",
    };
  }
  if (process.env.OPENAI_API_KEY) {
    const openai = new OpenAIClient({ apiKey: "stub" });
    return {
      profileId: "pm-spec",
      provider: "openai",
      model: openai.models[0]?.id ?? "",
    };
  }
  return {};
}

export function projectsRouter(projects: SqliteProjectRepository): Router {
  const r = Router();

  r.get("/", (_req, res) => {
    res.json(projects.list());
  });

  r.post("/", (req, res, next) => {
    try {
      const body = req.body as {
        source?: { type?: string; localPath?: unknown };
        ai?: Record<string, unknown>;
      };
      if (body?.source?.type === "local") {
        body.source.localPath = validateLocalPath(body.source.localPath);
      }
      // If the caller (wizard / API client) didn't pass an `ai` block, fill
      // it in from env so the project isn't silently created with the stub
      // provider that fails JSON parse on every item.
      const incomingAi = body.ai;
      const hasUsableAi =
        incomingAi &&
        typeof incomingAi === "object" &&
        typeof (incomingAi as { provider?: unknown }).provider === "string" &&
        (incomingAi as { provider: string }).provider !== "";
      if (!hasUsableAi) {
        body.ai = autoDetectAiConfig();
      }
      const project = projects.create(req.body);
      res.status(201).json(project);
    } catch (err) {
      next(err);
    }
  });

  r.get("/:slug", validateSlug("slug"), (req, res, next) => {
    const project = projects.findBySlug(req.params.slug as string);
    if (!project) return next(httpError(404, "Project not found"));
    res.json(project);
  });

  r.patch("/:slug", validateSlug("slug"), (req, res, next) => {
    try {
      const updated = projects.update(req.params.slug as string, req.body);
      if (!updated) return next(httpError(404, "Project not found"));
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  r.delete("/:slug", validateSlug("slug"), (req, res, next) => {
    const ok = projects.delete(req.params.slug as string);
    if (!ok) return next(httpError(404, "Project not found"));
    res.status(204).end();
  });

  return r;
}
