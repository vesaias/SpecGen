import { existsSync } from "node:fs";
import path from "node:path";
import { Router } from "express";
import { httpError } from "../middleware/errorHandler.js";
import { validateSlug } from "../middleware/validateSlug.js";
import type { SqliteProjectRepository } from "../repositories/SqliteProjectRepository.js";
import type { RunWorker } from "../services/RunWorker.js";
import type { TokenStore, TokenValue } from "../services/TokenStore.js";
import { getProjectDataDir } from "../services/projectDataDir.js";

/**
 * Capture connector config persisted on `project.connectors.capture`. Stores
 * the non-secret parts of the CaptureConfig: baseUrl, auth selectors, sizing.
 * Plaintext credentials live in the encrypted `capture-auth` token, NEVER in
 * the project row.
 */
export interface CaptureConnectorCfg {
  baseUrl: string;
  /**
   * Auth type — drives which token shape we expect to find under
   * `capture-auth`. "none" means no token needed.
   */
  authType?: "none" | "cookie" | "header" | "basic" | "form" | "localStorage";
  maxItems?: number;
  timeoutPerPageSec?: number;
  /**
   * Extra cookies applied to every capture context, regardless of authType.
   * Use when the SPA needs both a primary auth method (e.g. localStorage
   * api_key) AND a server-issued session cookie that gates API requests.
   * Non-secret data — values stored in the project record (NOT the token
   * store). For sensitive cookie values, prefer authType=cookie.
   */
  extraCookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
  }>;
}

function readCaptureCfg(connectors: Record<string, unknown>): CaptureConnectorCfg | null {
  const raw = (connectors as { capture?: CaptureConnectorCfg }).capture;
  if (!raw || typeof raw !== "object" || typeof raw.baseUrl !== "string") return null;
  return raw;
}

/**
 * REST surface for the frontend-capture generator (Capture feature).
 * Mounted under `/api/v0/projects`.
 *
 *   POST /api/v0/projects/:slug/capture                    → enqueue capture run
 *   GET  /api/v0/projects/:slug/captures/:file             → serve screenshot
 */
export function capturesRouter(deps: {
  projects: SqliteProjectRepository;
  tokens: TokenStore;
  worker: RunWorker;
}): Router {
  const r = Router({ mergeParams: true });

  // POST /:slug/capture — enqueue a frontend-capture run
  r.post("/:slug/capture", validateSlug("slug"), async (req, res, next) => {
    try {
      const project = deps.projects.findBySlug(req.params.slug as string);
      if (!project) return next(httpError(404, "Project not found"));

      const cfg = readCaptureCfg(project.connectors);
      if (!cfg) {
        return next(
          httpError(
            400,
            "capture connector not configured (set connectors.capture.baseUrl in project settings)",
          ),
        );
      }

      // Resolve auth from token store, if any
      let auth: unknown = { type: "none" };
      if (cfg.authType && cfg.authType !== "none") {
        const tok = await deps.tokens.get({
          projectId: project.id,
          provider: "capture-auth",
        });
        if (!tok || tok.provider !== "capture-auth") {
          return next(
            httpError(
              400,
              `capture authType=${cfg.authType} but no capture-auth token found — save credentials in Capture settings`,
            ),
          );
        }
        const captureToken = tok as Extract<TokenValue, { provider: "capture-auth" }>;
        // Belt-and-braces: ensure the stored auth shape's type matches the
        // configured authType. Mismatch means the user changed authType
        // without re-saving credentials.
        if (captureToken.auth.type !== cfg.authType) {
          return next(
            httpError(
              400,
              `capture token type (${captureToken.auth.type}) does not match configured authType (${cfg.authType}) — re-save credentials`,
            ),
          );
        }
        auth = captureToken.auth;
      }

      const body = (req.body ?? {}) as { itemIds?: string[]; profile?: string };
      const itemIds =
        Array.isArray(body.itemIds) && body.itemIds.every((s) => typeof s === "string")
          ? body.itemIds
          : undefined;

      const outputDir = path.join(getProjectDataDir(project), "captures");

      const profileId =
        body.profile ?? (project.ai as { profileId?: string } | undefined)?.profileId ?? "pm-spec";

      // The container exports CHROME_HEADLESS_SHELL_PATH for the PDF exporter;
      // we reuse the same binary for Playwright (chrome-headless-shell is a
      // build of chromium that ships with the Puppeteer install). Outside the
      // container the operator can set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
      const executablePath =
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
        process.env.CHROME_HEADLESS_SHELL_PATH ??
        undefined;

      const captureConfig = {
        baseUrl: cfg.baseUrl,
        auth,
        maxItems: cfg.maxItems,
        timeoutPerPageSec: cfg.timeoutPerPageSec,
        executablePath,
        extraCookies: cfg.extraCookies,
      };

      const runId = deps.worker.enqueue({
        projectId: project.id,
        generatorId: "frontend-capture",
        profileId,
        options: {
          captureConfig,
          outputDir,
          ...(itemIds ? { itemIds } : {}),
        },
      });

      res.status(201).json({ runId, status: "queued" });
    } catch (err) {
      next(err);
    }
  });

  // GET /:slug/capture/auth-summary — returns the SAVED capture-auth in a
  // shape safe to render in the settings form: secret values masked, all
  // identifiers / selectors / URLs / names returned in the clear so the user
  // can see exactly what's configured without us re-decrypting on every
  // settings page load.
  r.get("/:slug/capture/auth-summary", validateSlug("slug"), async (req, res, next) => {
    try {
      const project = deps.projects.findBySlug(req.params.slug as string);
      if (!project) return next(httpError(404, "Project not found"));
      const tok = await deps.tokens.get({
        projectId: project.id,
        provider: "capture-auth",
      });
      if (!tok || tok.provider !== "capture-auth") {
        return res.json({ configured: false });
      }
      const captureToken = tok as Extract<TokenValue, { provider: "capture-auth" }>;
      const a = captureToken.auth;
      const SECRET = "●●●●●●●●";
      // Per auth-type: keep selectors/URLs/names/keys visible, mask values.
      let summary: Record<string, unknown> = { authType: a.type };
      if (a.type === "form") {
        summary = {
          authType: "form",
          loginUrl: a.loginUrl,
          usernameSelector: a.usernameSelector,
          passwordSelector: a.passwordSelector,
          submitSelector: a.submitSelector,
          usernameValue: a.usernameValue || "", // username is identifying, not secret
          passwordValueSaved: Boolean(a.passwordValue),
          passwordPlaceholder: a.passwordValue ? SECRET : "",
          postLoginUrlContains: a.postLoginUrlContains ?? "",
        };
      } else if (a.type === "basic") {
        summary = {
          authType: "basic",
          username: a.username || "",
          passwordSaved: Boolean(a.password),
          passwordPlaceholder: a.password ? SECRET : "",
        };
      } else if (a.type === "cookie") {
        summary = {
          authType: "cookie",
          cookies: a.cookies.map((c) => ({
            name: c.name,
            domain: c.domain ?? "",
            path: c.path ?? "",
            valueSaved: Boolean(c.value),
            valuePlaceholder: c.value ? SECRET : "",
          })),
        };
      } else if (a.type === "header") {
        summary = {
          authType: "header",
          headers: Object.keys(a.headers ?? {}).map((name) => ({
            name,
            valueSaved: Boolean(a.headers[name]),
            valuePlaceholder: a.headers[name] ? SECRET : "",
          })),
        };
      } else if (a.type === "localStorage") {
        summary = {
          authType: "localStorage",
          entries: (a.entries ?? []).map((e) => ({
            key: e.key,
            valueSaved: Boolean(e.value),
            valuePlaceholder: e.value ? SECRET : "",
          })),
        };
      } else {
        summary = { authType: "none" };
      }
      res.json({ configured: true, ...summary });
    } catch (err) {
      next(err);
    }
  });

  // POST /:slug/capture/test — auth-only dry-run. Verifies baseUrl is
  // reachable and configured auth applies cleanly. No screenshots, no DOM
  // walk, no spec writes — pure connectivity check before the user commits
  // to a full capture run.
  //
  // Body is OPTIONAL. When provided, its baseUrl + auth fully override the
  // saved project config and token — lets the webapp validate unsaved form
  // edits ("Test connection" should work without forcing a Save first).
  // When body is absent, falls back to the saved project config + token.
  r.post("/:slug/capture/test", validateSlug("slug"), async (req, res, next) => {
    try {
      const project = deps.projects.findBySlug(req.params.slug as string);
      if (!project) return next(httpError(404, "Project not found"));

      const body = (req.body ?? {}) as {
        baseUrl?: string;
        auth?: unknown;
        timeoutPerPageSec?: number;
        extraCookies?: Array<{ name: string; value: string; domain?: string; path?: string }>;
      };

      let baseUrl: string;
      let auth: unknown;
      let timeoutPerPageSec: number | undefined;
      let extraCookies: typeof body.extraCookies;

      if (typeof body.baseUrl === "string" && body.baseUrl.trim()) {
        // Inline mode: trust the body, no DB/token reads.
        baseUrl = body.baseUrl.trim();
        auth = body.auth ?? { type: "none" };
        timeoutPerPageSec = body.timeoutPerPageSec;
        extraCookies = body.extraCookies;
      } else {
        // Fallback: use the saved project config + stored token (legacy path).
        const cfg = readCaptureCfg(project.connectors);
        if (!cfg) {
          return next(
            httpError(
              400,
              "capture connector not configured (set connectors.capture.baseUrl in project settings, or POST with baseUrl in the body)",
            ),
          );
        }
        baseUrl = cfg.baseUrl;
        timeoutPerPageSec = cfg.timeoutPerPageSec;
        auth = { type: "none" };
        if (cfg.authType && cfg.authType !== "none") {
          const tok = await deps.tokens.get({
            projectId: project.id,
            provider: "capture-auth",
          });
          if (!tok || tok.provider !== "capture-auth") {
            return next(
              httpError(
                400,
                `capture authType=${cfg.authType} but no capture-auth token found — save credentials in Capture settings, or include auth in the request body`,
              ),
            );
          }
          const captureToken = tok as Extract<TokenValue, { provider: "capture-auth" }>;
          if (captureToken.auth.type !== cfg.authType) {
            return next(
              httpError(
                400,
                `capture token type (${captureToken.auth.type}) does not match configured authType (${cfg.authType}) — re-save credentials`,
              ),
            );
          }
          auth = captureToken.auth;
        }
        // For the fallback (saved-config) path, also pull extraCookies from
        // the saved capture config so Test connection mirrors the real run.
        extraCookies = (readCaptureCfg(project.connectors) as CaptureConnectorCfg | null)
          ?.extraCookies;
      }

      const executablePath =
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
        process.env.CHROME_HEADLESS_SHELL_PATH ??
        undefined;

      const { probeFrontend } = await import("@specgen/parser-frontend-capture");
      const result = await probeFrontend({
        baseUrl,
        auth: auth as never,
        timeoutPerPageSec,
        executablePath,
        extraCookies,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // GET /:slug/captures/:file — serve a screenshot. Filename is matched
  // against a strict allowlist before disk access; absolute resolution is
  // contained inside the per-project captures dir.
  r.get("/:slug/captures/:file", validateSlug("slug"), (req, res, next) => {
    try {
      const project = deps.projects.findBySlug(req.params.slug as string);
      if (!project) return next(httpError(404, "Project not found"));

      const file = req.params.file as string;
      // Strict allowlist: alnum + dot + underscore + hyphen, single .png extension.
      if (!/^[a-zA-Z0-9._-]+\.png$/.test(file)) {
        return next(httpError(400, "Invalid filename"));
      }
      // Reject any leading dot to keep dotfiles + traversal off-table.
      if (file.startsWith(".") || file.includes("..")) {
        return next(httpError(400, "Invalid filename"));
      }

      const capturesRoot = path.resolve(getProjectDataDir(project), "captures");
      const filePath = path.resolve(capturesRoot, file);
      // Defence in depth: even with the regex above, verify resolved path
      // stays inside the captures dir.
      if (!filePath.startsWith(capturesRoot + path.sep) && filePath !== capturesRoot) {
        return next(httpError(400, "Invalid path"));
      }
      if (!existsSync(filePath)) return next(httpError(404, "Screenshot not found"));

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "private, max-age=60");
      res.sendFile(filePath);
    } catch (err) {
      next(err);
    }
  });

  return r;
}
