/**
 * frontend-capture — Built-in generator that runs Playwright against the
 * project's already-parsed frontend items and augments each one with a
 * screenshot + observed XHR/fetch calls.
 *
 * This is a POST-PARSE generator: it reads the existing Spec (error if none),
 * filters to `type === "frontend"` items, hands them to
 * `@specgen/parser-frontend-capture`, and merges the results back into each
 * FrontendSpecItem (`screenshot` + `observedApiCalls`).
 *
 * The capture pipeline itself lives in its own package because Playwright is
 * a heavy dependency we don't want pulling into anyone using only the core
 * spec runtime. Core declares the dep as a peer (loaded dynamically below),
 * so a pure-spec consumer can `pnpm install @specgen/core` without dragging
 * Chromium in.
 *
 * Options (threaded through `ctx.options`):
 *   - captureConfig: CaptureConfig (REQUIRED — the server reads this from the
 *                    project record and resolves auth via the TokenStore)
 *   - outputDir:     string (REQUIRED — absolute path where screenshots are
 *                    written; the server uses `<projectDataDir>/captures`)
 *   - itemIds?:      string[] (when set, only those frontend items are
 *                    captured; otherwise all frontend items, capped at
 *                    captureConfig.maxItems)
 */

import { createHash } from "node:crypto";
import { emptyRunSummary } from "../../run/RunSummary.js";
import type { FrontendSpecItem, SpecItem } from "../../spec/types.js";
import type { GeneratorContext, GeneratorPlugin } from "../Generator.js";

export interface FrontendCaptureOpts {
  captureConfig: {
    baseUrl: string;
    auth?: unknown;
    maxItems?: number;
    timeoutPerPageSec?: number;
    executablePath?: string;
  };
  outputDir: string;
  itemIds?: string[];
}

export const frontendCaptureGenerator: GeneratorPlugin = {
  id: "frontend-capture",
  name: "Frontend page capture",
  description:
    "Opens each frontend route in a real Chromium and attaches a screenshot + observed network calls to the spec item.",
  supports_profiles: "*",
  supports_parsers: "*",
  produces_item_types: ["frontend"],

  async *run(ctx: GeneratorContext) {
    const opts = (ctx.options ?? {}) as Partial<FrontendCaptureOpts>;
    if (!opts.captureConfig || typeof opts.captureConfig.baseUrl !== "string") {
      yield {
        type: "error" as const,
        error: new Error(
          "frontend-capture requires options.captureConfig.baseUrl — wire it through the server's capture API",
        ),
      };
      yield { type: "done" as const, stats: emptyRunSummary() };
      return;
    }
    if (!opts.outputDir) {
      yield {
        type: "error" as const,
        error: new Error("frontend-capture requires options.outputDir (absolute path)"),
      };
      yield { type: "done" as const, stats: emptyRunSummary() };
      return;
    }

    yield { type: "progress" as const, message: "Loading existing spec…" };
    const existing = await ctx.spec.read();
    if (!existing) {
      yield {
        type: "error" as const,
        error: new Error("frontend-capture requires an existing spec — run full-tree-spec first"),
      };
      yield { type: "done" as const, stats: emptyRunSummary() };
      return;
    }

    const shallow = Object.values(existing.items).filter(
      (i): i is FrontendSpecItem => (i as SpecItem).type === "frontend",
    );
    const filterIds = opts.itemIds && opts.itemIds.length > 0 ? new Set(opts.itemIds) : null;
    const shallowTargets = filterIds ? shallow.filter((i) => filterIds.has(i.id)) : shallow;
    // spec.read() only fills the SHALLOW items map ({id, type, title}). The
    // route + other fields live in the per-item JSON files, so we have to
    // readItem() each one to get the actual route. Without this, every item
    // ends up with route=undefined and captureFrontend navigates to "/" for
    // ALL of them — every page renders the home component, regardless of URL.
    const targets: FrontendSpecItem[] = [];
    for (const s of shallowTargets) {
      const full = await ctx.spec.readItem(s.id);
      if (full && full.type === "frontend") targets.push(full as FrontendSpecItem);
    }

    if (targets.length === 0) {
      yield {
        type: "warning" as const,
        message: filterIds
          ? "frontend-capture: no frontend items matched the supplied itemIds"
          : "frontend-capture: spec has no frontend items to capture",
      };
      yield { type: "done" as const, stats: emptyRunSummary() };
      return;
    }

    yield {
      type: "progress" as const,
      message: `Capturing ${targets.length} frontend page${targets.length === 1 ? "" : "s"} from ${opts.captureConfig.baseUrl}…`,
    };

    // Dynamic import — keeps Playwright out of the dep graph for consumers
    // that only use the core spec runtime.
    let captureFrontend: typeof import("@specgen/parser-frontend-capture").captureFrontend;
    try {
      const mod = await import("@specgen/parser-frontend-capture");
      captureFrontend = mod.captureFrontend;
    } catch (err) {
      yield {
        type: "error" as const,
        error: new Error(
          `frontend-capture: failed to load @specgen/parser-frontend-capture — is it installed? (${(err as Error).message})`,
        ),
      };
      yield { type: "done" as const, stats: emptyRunSummary() };
      return;
    }

    const captureCfg = {
      baseUrl: opts.captureConfig.baseUrl,
      auth: opts.captureConfig.auth as
        | import("@specgen/parser-frontend-capture").CaptureAuth
        | undefined,
      maxItems: opts.captureConfig.maxItems,
      timeoutPerPageSec: opts.captureConfig.timeoutPerPageSec,
      executablePath: opts.captureConfig.executablePath,
    };

    let result: Awaited<ReturnType<typeof captureFrontend>>;
    try {
      result = await captureFrontend(
        targets.map((i) => ({ id: i.id, route: i.route })),
        captureCfg,
        opts.outputDir,
      );
    } catch (err) {
      yield { type: "error" as const, error: err as Error };
      yield { type: "done" as const, stats: emptyRunSummary() };
      return;
    }

    for (const w of result.warnings) {
      yield { type: "warning" as const, message: w };
    }

    let updated = 0;
    let warnings = result.warnings.length;
    const capturedItemIds: string[] = [];
    for (const r of result.results) {
      if (r.error) {
        yield {
          type: "warning" as const,
          message: `${r.itemId}: ${r.error}`,
        };
        warnings++;
        continue;
      }
      const item = await ctx.spec.readItem(r.itemId);
      if (!item || item.type !== "frontend") continue;
      const captureHash = computeCaptureHash(r);
      const next: FrontendSpecItem = {
        ...(item as FrontendSpecItem),
        screenshot: r.screenshotPath
          ? // Stored relative — the server's static-captures route resolves it
            // under the project's data dir.
            `captures/${r.screenshotPath}`
          : item.screenshot,
        observedApiCalls: r.observedApiCalls,
        observedSections: r.observedSections,
        observedTitle: r.title,
        landedH1: r.landedH1,
        landedUrl: r.landedUrl,
        captureNavStatus: r.navStatus,
        captureAuthLikelyFailed: r.authLikelyFailed,
        captureHash,
      };
      capturedItemIds.push(r.itemId);
      await ctx.spec.writeItem(next);

      // Per-item progress line with what URL we asked for, where we landed,
      // and the page's H1 — surfaces SPA-driven redirects (e.g. "asked
      // /applications, landed /, h1=Job Feed") at the operator's eye.
      if (r.requestedUrl && r.landedUrl) {
        const reqPath = r.requestedUrl.replace(/^https?:\/\/[^/]+/, "");
        const landedPath = r.landedUrl.replace(/^https?:\/\/[^/]+/, "");
        const redirected = reqPath !== landedPath ? " ⚠ REDIRECTED" : "";
        const h1 = r.landedH1 ? ` h1=${JSON.stringify(r.landedH1)}` : "";
        yield {
          type: "progress" as const,
          message: `${r.itemId}: asked ${reqPath}${redirected ? ` → landed ${landedPath}` : ""}${h1}`,
        };
      }
      yield { type: "item-updated" as const, itemId: r.itemId };
      updated++;
    }

    yield {
      type: "done" as const,
      stats: {
        itemsCreated: 0,
        itemsUpdated: updated,
        itemsRemoved: 0,
        warnings,
        aiCalls: [],
        aiCostUsdTotal: 0,
        // Forward the list of items that received new capture data so the
        // server (or the calling orchestrator) can chain an AI enrichment run
        // scoped to exactly those items. Read off the done event in
        // autoEnrichAfterCapture.
        capturedItemIds,
      },
    };
  },
};

/**
 * Stable fingerprint of the page-capture observations the AI prompt cares
 * about. Only the data shown to the model is hashed — purely visual fields
 * like `screenshotPath`, `navStatus`, and `landedUrl` are excluded so we
 * don't trigger an AI re-run when nothing the model can see actually changed.
 *
 * `sourceFiles` are intentionally excluded — `enrichedSourceHash` already
 * handles source drift, and mixing them here would conflate the two signals.
 */
function computeCaptureHash(r: {
  observedSections?: unknown;
  observedApiCalls?: unknown;
  landedH1?: string;
  title?: string;
}): string {
  const payload = JSON.stringify({
    sections: r.observedSections ?? [],
    apiCalls: r.observedApiCalls ?? [],
    h1: r.landedH1 ?? "",
    title: r.title ?? "",
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
