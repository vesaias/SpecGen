import { JsonSpecRepository, markdownItemExporter, markdownZipExporter } from "@specgen/core";
import { Router } from "express";
import { httpError } from "../middleware/errorHandler.js";
import { validateSlug } from "../middleware/validateSlug.js";
import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import type { PdfService } from "../services/PdfService.js";
import { getProjectDataDir } from "../services/projectDataDir.js";

/**
 * REST endpoints for spec export (Phase D — Task D.3 + fast-follow v0.2 Task F.3).
 * Mounted under `/api/v0/projects` per PD3.
 *
 *   GET /api/v0/projects/:slug/spec/item/:id/export.md   → single item as Markdown
 *   GET /api/v0/projects/:slug/export.zip                → whole spec as Markdown zip
 *   GET /api/v0/projects/:slug/spec/item/:id/export.pdf  → single item as PDF
 *                                                          (requires CHROME_HEADLESS_SHELL_PATH)
 */
export function exportsRouter(deps: {
  projects: SqliteProjectRepository;
  pdf?: PdfService;
}): Router {
  const r = Router({ mergeParams: true });

  // Single-item Markdown export
  r.get("/:slug/spec/item/:id/export.md", validateSlug("slug"), async (req, res, next) => {
    try {
      const project = deps.projects.findBySlug(req.params.slug as string);
      if (!project) return next(httpError(404, "Project not found"));
      const repo = new JsonSpecRepository(getProjectDataDir(project));
      res.type("text/markdown; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${req.params.id}.md"`);
      for await (const ev of markdownItemExporter.run({
        spec: repo,
        output: res,
        format: "md",
        options: { itemId: req.params.id },
      })) {
        if (ev.type === "error") {
          res.removeHeader("Content-Type");
          return next(ev.error);
        }
      }
      res.end();
    } catch (err) {
      next(err);
    }
  });

  // Whole-project Markdown zip export
  r.get("/:slug/export.zip", validateSlug("slug"), async (req, res, next) => {
    try {
      const project = deps.projects.findBySlug(req.params.slug as string);
      if (!project) return next(httpError(404, "Project not found"));
      const repo = new JsonSpecRepository(getProjectDataDir(project));
      res.type("application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${req.params.slug as string}-spec.zip"`,
      );
      for await (const ev of markdownZipExporter.run({
        spec: repo,
        output: res,
        format: "zip",
      })) {
        if (ev.type === "error") {
          if (!res.headersSent) {
            // Nothing sent yet — deliver a clean HTTP 500.
            return next(ev.error);
          }
          // Mid-stream: tear down the connection so the client doesn't
          // silently accept a truncated zip.
          res.destroy(ev.error instanceof Error ? ev.error : new Error(String(ev.error)));
          return;
        }
      }
    } catch (err) {
      next(err);
    }
  });

  // Single-item PDF export (Phase D fast-follow v0.2). Drives the running
  // webapp via Puppeteer; gated at the route level on whether the server was
  // booted with a PdfService (CHROME_HEADLESS_SHELL_PATH set).
  r.get("/:slug/spec/item/:id/export.pdf", validateSlug("slug"), async (req, res, next) => {
    try {
      if (!deps.pdf) {
        return next(
          httpError(
            503,
            "PDF export not configured — install chrome-headless-shell and set CHROME_HEADLESS_SHELL_PATH",
          ),
        );
      }
      const slug = req.params.slug as string;
      const itemId = req.params.id as string;
      const project = deps.projects.findBySlug(slug);
      if (!project) return next(httpError(404, "Project not found"));

      // PdfService talks to the same Express process via loopback. The webapp
      // route is `/projects/:slug` with hash-based item navigation
      // (`#<itemId>`); the print-mode hook reads `?print=1` from the query
      // string, so we put the query before the fragment.
      const baseUrl =
        process.env.SPECGEN_INTERNAL_URL ??
        `http://127.0.0.1:${process.env.SPECGEN_BIND_PORT ?? 6101}`;
      const url = `${baseUrl}/projects/${encodeURIComponent(slug)}?print=1#${encodeURIComponent(itemId)}`;

      const buf = await deps.pdf.render({ url });
      res.type("application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${itemId}.pdf"`);
      res.send(buf);
    } catch (err) {
      next(err);
    }
  });

  return r;
}
