import type { ParserRegistry } from "@specgen/core";
import { Router } from "express";
import { httpError } from "../middleware/errorHandler.js";
import { buildGitHubFsFromCreds } from "../services/githubFsFactory.js";
import { probeProject } from "../services/probeProject.js";
import { validateLocalPath } from "../services/validateLocalPath.js";

export function probeRouter(deps: { parsers: ParserRegistry }): Router {
  const r = Router();

  r.post("/probe", async (req, res, next) => {
    try {
      const body = req.body as { source?: unknown };

      if (!body.source || typeof body.source !== "object") {
        return next(httpError(400, "Body.source is required"));
      }

      const src = body.source as Record<string, unknown>;

      if (src.type === "local") {
        // validateLocalPath throws a 400-typed Error on bad input
        src.localPath = validateLocalPath(src.localPath);
      } else if (src.type === "github") {
        // Require owner, repo, and token for GitHub probe
        if (
          typeof src.owner !== "string" ||
          !src.owner ||
          typeof src.repo !== "string" ||
          !src.repo ||
          typeof src.token !== "string" ||
          !src.token
        ) {
          return next(httpError(400, "GitHub source requires owner, repo, and token (string)"));
        }
        // ref is optional; default is applied in probeProject
      } else {
        return next(httpError(400, `Unsupported source.type: ${String(src.type)}`));
      }

      const report = await probeProject(
        { source: src } as Parameters<typeof probeProject>[0],
        deps.parsers,
        buildGitHubFsFromCreds,
      );

      res.json(report);
    } catch (err) {
      next(err);
    }
  });

  return r;
}
