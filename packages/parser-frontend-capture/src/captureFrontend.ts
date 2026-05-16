/**
 * captureFrontend — Playwright-driven page capture for SpecGen.
 *
 * Opens each `FrontendItem.route` in a real Chromium, applies auth, takes a
 * full-page screenshot, watches XHR/fetch traffic during page load, and walks
 * the rendered DOM for structural sections (cards, tables, forms).
 *
 * Design choices:
 *   - Single browser, fresh context per item — cookies/storage don't leak
 *     between routes unless explicitly configured to.
 *   - `form` auth uses one PRIMING context (login → cookies captured via
 *     `storageState`) which we then re-apply per-item, so we don't re-log-in
 *     for every page.
 *   - Errors per page never throw — they're recorded on the result and we move
 *     on. The only fatal path is "browser failed to launch".
 *
 * The package depends on `playwright-core` (the runtime, not the install
 * driver). In Docker we expect the operator to install Chromium separately
 * (the `frontend-capture` generator in the server points `executablePath` at
 * the same chrome-headless-shell binary used by the PDF exporter when no
 * Playwright-managed browser is available).
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  type Browser,
  type BrowserContext,
  type LaunchOptions,
  type Page,
  chromium,
} from "playwright-core";
import type {
  CaptureConfig,
  CaptureFrontendItem,
  CaptureItemResult,
  CaptureResult,
  ObservedApiCall,
  ObservedSection,
} from "./types.js";

const DEFAULT_MAX_ITEMS = 50;
const DEFAULT_TIMEOUT_SEC = 15;

/**
 * Run the capture pipeline. NEVER throws — top-level failures (e.g. browser
 * launch error) are surfaced as a `warnings[]` entry plus empty `results[]`.
 */
export async function captureFrontend(
  items: CaptureFrontendItem[],
  cfg: CaptureConfig,
  outputDir: string,
): Promise<CaptureResult> {
  const warnings: string[] = [];
  const results: CaptureItemResult[] = [];

  const maxItems = cfg.maxItems ?? DEFAULT_MAX_ITEMS;
  const timeoutMs = (cfg.timeoutPerPageSec ?? DEFAULT_TIMEOUT_SEC) * 1000;
  const baseUrl = cfg.baseUrl.replace(/\/+$/, ""); // trim trailing slashes

  const itemsToCapture = items.slice(0, maxItems);
  if (items.length > maxItems) {
    warnings.push(
      `capped at ${maxItems} items (${items.length - maxItems} skipped) — raise CaptureConfig.maxItems to capture more`,
    );
  }

  await mkdir(outputDir, { recursive: true });

  const launchOpts: LaunchOptions = { headless: true };
  if (cfg.executablePath) launchOpts.executablePath = cfg.executablePath;

  let browser: Browser;
  try {
    browser = await chromium.launch(launchOpts);
  } catch (err) {
    warnings.push(`chromium launch failed: ${(err as Error).message}`);
    return { results, warnings };
  }

  try {
    // For `form` auth we log in once and reuse the resulting cookies. For all
    // other auth modes there's nothing to prime; per-item contexts apply the
    // auth fresh.
    let formAuthStorage: Awaited<ReturnType<BrowserContext["storageState"]>> | null = null;
    let formAuthFailed = false;
    let formAuthError = "";
    if (cfg.auth?.type === "form") {
      const primingCtx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      try {
        const page = await primingCtx.newPage();
        await runFormLogin(page, cfg.auth, timeoutMs);
        formAuthStorage = await primingCtx.storageState();
      } catch (err) {
        formAuthFailed = true;
        formAuthError = (err as Error).message;
      } finally {
        await primingCtx.close().catch(() => undefined);
      }
    }

    // If form-auth priming failed we ABORT the whole run rather than
    // silently capture N pages anonymously. The previous behaviour produced
    // 50 useless screenshots of login bounces and only a buried warning in
    // the run log — much harder for the operator to diagnose than "the
    // login form selector is wrong, fix it and re-run".
    if (formAuthFailed) {
      warnings.push(
        `form login failed: ${formAuthError}. Aborting capture (set auth.type=none in Settings → Capture to capture anonymously, or fix the form selectors and retry).`,
      );
      return { results, warnings };
    }

    for (const item of itemsToCapture) {
      try {
        const result = await captureOne(
          browser,
          item,
          baseUrl,
          cfg,
          formAuthStorage,
          outputDir,
          timeoutMs,
        );
        results.push(result);
      } catch (err) {
        // Don't let one bad item kill the whole run. Record + continue.
        results.push({
          itemId: item.id,
          observedApiCalls: [],
          observedSections: [],
          error: `capture threw: ${(err as Error).message}`,
        });
      }
    }

    // Top-level auth-failure heuristic: if most items look auth-failed, the
    // configured credentials almost certainly aren't being applied. Surface a
    // single explicit warning rather than leaving the operator to grep through
    // per-item flags.
    const authFailedCount = results.filter((r) => r.authLikelyFailed).length;
    if (authFailedCount > 0) {
      const total = results.length;
      const ratio = total > 0 ? authFailedCount / total : 0;
      if (ratio >= 0.5) {
        warnings.push(
          `${authFailedCount}/${total} pages returned 401/403 — auth credentials likely incorrect or not applied. Use Test connection in Settings → Capture to verify.`,
        );
      } else {
        warnings.push(
          `${authFailedCount}/${total} pages hit 401/403 — partial auth failure (some routes may require additional scope).`,
        );
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  return { results, warnings };
}

// ---------------------------------------------------------------------------
// Per-item capture
// ---------------------------------------------------------------------------

async function captureOne(
  browser: Browser,
  item: CaptureFrontendItem,
  baseUrl: string,
  cfg: CaptureConfig,
  formAuthStorage: Awaited<ReturnType<BrowserContext["storageState"]>> | null,
  outputDir: string,
  timeoutMs: number,
): Promise<CaptureItemResult> {
  const auth = cfg.auth ?? { type: "none" };

  // Per-item context with applied auth
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(auth.type === "basic"
      ? { httpCredentials: { username: auth.username, password: auth.password } }
      : {}),
    ...(formAuthStorage ? { storageState: formAuthStorage } : {}),
  });

  try {
    // Apply extraCookies first — INDEPENDENT of the primary auth type. Lets
    // users stack e.g. localStorage api_key + server session cookie.
    if (cfg.extraCookies && cfg.extraCookies.length > 0) {
      const baseHost = safeHost(baseUrl);
      await ctx.addCookies(
        cfg.extraCookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain ?? baseHost ?? "",
          path: c.path ?? "/",
        })),
      );
    }
    if (auth.type === "cookie") {
      const baseHost = safeHost(baseUrl);
      await ctx.addCookies(
        auth.cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain ?? baseHost ?? "",
          path: c.path ?? "/",
        })),
      );
    } else if (auth.type === "header") {
      await ctx.setExtraHTTPHeaders(auth.headers);
    } else if (auth.type === "localStorage") {
      const initScript = `(function(){try{${auth.entries
        .map(
          (e) =>
            `window.localStorage.setItem(${JSON.stringify(e.key)}, ${JSON.stringify(e.value)});`,
        )
        .join("")}}catch(e){}})();`;
      await ctx.addInitScript({ content: initScript });
    }

    const apiCalls: ObservedApiCall[] = [];
    const page = await ctx.newPage();
    page.on("response", (res) => {
      try {
        const req = res.request();
        const rt = req.resourceType();
        if (rt === "xhr" || rt === "fetch") {
          apiCalls.push({
            method: req.method(),
            url: res.url().replace(baseUrl, ""),
            status: res.status(),
          });
        }
      } catch {
        // page closed mid-response — ignore
      }
    });

    // Some parsers (especially the AI parser, or React projects with
    // dynamically-built routes) can produce FrontendSpec items where `route`
    // is undefined or empty. Default to "/" rather than crashing the whole
    // run — Playwright still gives us the home page + observed API calls.
    const rawRoute = typeof item.route === "string" && item.route.length > 0 ? item.route : "/";
    const url = `${baseUrl}${rawRoute.startsWith("/") ? rawRoute : `/${rawRoute}`}`;
    let navStatus: number | null = null;
    let landedUrl: string | undefined;
    let landedH1: string | undefined;
    try {
      const resp = await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
      navStatus = resp?.status() ?? null;
      // Capture where we actually ended up — surfaces SPA-driven redirects
      // that page.goto's resp doesn't show.
      landedUrl = page.url();
      try {
        landedH1 = await page.evaluate(
          () => document.querySelector("h1,h2")?.textContent?.trim() ?? "",
        );
      } catch {
        // page closed or eval failed — non-fatal
      }
    } catch (err) {
      // Don't fail the whole capture — still try to screenshot whatever rendered
      // before the timeout fired.
      return {
        itemId: item.id,
        observedApiCalls: apiCalls,
        observedSections: [],
        navStatus: null,
        authLikelyFailed: detectAuthFailure(null, apiCalls),
        error: `goto failed: ${(err as Error).message}`,
      };
    }

    // Tiny settle delay so animated content + late hydration has a chance to
    // paint before the screenshot. Capped to keep total per-page time bounded.
    await page.waitForTimeout(500);

    const safeId = item.id.replace(/[^a-z0-9-_]/gi, "-");
    const fileName = `${safeId}.png`;
    const absScreenshot = path.join(outputDir, fileName);
    let screenshotPath: string | undefined;
    try {
      await page.screenshot({ path: absScreenshot, fullPage: true });
      screenshotPath = fileName;
    } catch (err) {
      return {
        itemId: item.id,
        observedApiCalls: apiCalls,
        observedSections: [],
        error: `screenshot failed: ${(err as Error).message}`,
      };
    }

    let title: string | undefined;
    let observedSections: ObservedSection[] = [];
    try {
      title = await page.title();
      observedSections = await extractSections(page);
    } catch (err) {
      // DOM walk is best-effort
      return {
        itemId: item.id,
        screenshotPath,
        title,
        observedApiCalls: apiCalls,
        observedSections,
        error: `dom walk failed: ${(err as Error).message}`,
      };
    }

    return {
      itemId: item.id,
      screenshotPath,
      title,
      observedApiCalls: apiCalls,
      observedSections,
      navStatus,
      authLikelyFailed: detectAuthFailure(navStatus, apiCalls),
      requestedUrl: url,
      landedUrl,
      landedH1,
    };
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/**
 * Decide whether this item smells like an auth failure.
 *
 * True when:
 *  - Page navigation returned 401/403, OR
 *  - At least one observed XHR/fetch returned 401/403 AND no API call returned
 *    a 2xx (i.e. nothing on the page successfully authenticated).
 */
function detectAuthFailure(navStatus: number | null, apiCalls: ObservedApiCall[]): boolean {
  if (navStatus === 401 || navStatus === 403) return true;
  if (apiCalls.length === 0) return false;
  const has401 = apiCalls.some((c) => c.status === 401 || c.status === 403);
  const hasSuccess = apiCalls.some((c) => c.status >= 200 && c.status < 300);
  return has401 && !hasSuccess;
}

// ---------------------------------------------------------------------------
// Form-login helper (one-shot priming context)
// ---------------------------------------------------------------------------

async function runFormLogin(
  page: Page,
  auth: Extract<Required<CaptureConfig>["auth"], { type: "form" }>,
  timeoutMs: number,
): Promise<void> {
  await page.goto(auth.loginUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  // Username is optional — some apps pre-fill from a token in the URL, others
  // are password-only. Skip the fill step when no selector OR no value.
  if (auth.usernameSelector && auth.usernameValue) {
    await page.fill(auth.usernameSelector, auth.usernameValue, { timeout: timeoutMs });
  }
  await page.fill(auth.passwordSelector, auth.passwordValue, { timeout: timeoutMs });
  // Click submit and wait for either the URL to change to the configured
  // post-login marker OR networkidle (whichever happens first).
  const navP = page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => undefined);
  await page.click(auth.submitSelector, { timeout: timeoutMs });
  if (auth.postLoginUrlContains) {
    const expected = auth.postLoginUrlContains;
    await page.waitForFunction((needle) => location.href.includes(needle), expected, {
      timeout: timeoutMs,
    });
  } else {
    await navP;
  }
}

// ---------------------------------------------------------------------------
// DOM section extraction (ported from old playwrightCapture.ts, genericised)
// ---------------------------------------------------------------------------

async function extractSections(page: Page): Promise<ObservedSection[]> {
  // The evaluate body runs in the page context with no closure — keep it
  // self-contained. Pulls out structural regions (cards/tables/forms/lists) +
  // their interactive elements. Deduplicates overlapping containers by text.
  const raw = await page.evaluate(() => {
    type Out = {
      selector: string;
      heading: string;
      type: "card" | "table" | "chart" | "form" | "list" | "other";
      visibleText: string;
      tableColumns?: string[];
      tableRowCount?: number;
      elements: Array<{
        tag: string;
        type?: string;
        text: string;
        role?: string;
        disabled: boolean;
        href?: string;
        placeholder?: string;
      }>;
    };
    const results: Out[] = [];

    // Heuristic container selectors — broad on purpose so unfamiliar design
    // systems still surface something. Filter junk via the size + nested
    // dedupe passes below.
    const candidateSelector = [
      ".bg-white",
      "[class*='rounded-xl']",
      "[class*='rounded-lg']",
      "[class*='border-gray']",
      "[class*='border-stone']",
      "[class*='border-slate']",
      "section",
      "article",
      "main > div",
    ].join(", ");

    document.querySelectorAll(candidateSelector).forEach((el) => {
      // Skip sidebar / nav chrome
      if (el.closest("aside, nav, [role='navigation']")) return;
      const rect = (el as Element).getBoundingClientRect();
      if (rect.width < 120 || rect.height < 60) return;

      let type: Out["type"] = "other";
      if (el.querySelector("table")) type = "table";
      else if (
        el.querySelector("canvas, svg.recharts-surface, .recharts-wrapper, [class*='chart']")
      )
        type = "chart";
      else if (el.querySelector("form, input, select, textarea")) type = "form";
      else if (el.querySelectorAll("a").length > 3) type = "list";
      else type = "card";

      const heading = el.querySelector(
        "h1, h2, h3, h4, [class*='font-semibold'], [class*='font-bold']",
      );
      const headingText = heading ? (heading.textContent ?? "").trim().slice(0, 120) : "";

      const visibleText = (el.textContent ?? "").trim().slice(0, 400);

      let tableColumns: string[] | undefined;
      let tableRowCount: number | undefined;
      const table = el.querySelector("table");
      if (table) {
        const ths = table.querySelectorAll("th");
        tableColumns = Array.from(ths).map((th) => (th.textContent ?? "").trim());
        tableRowCount = table.querySelectorAll("tbody tr").length;
      }

      const elements: Out["elements"] = [];
      el.querySelectorAll("button, a[href], input, select, textarea").forEach((child) => {
        const tag = child.tagName.toLowerCase();
        if (tag === "a" && !(child as HTMLAnchorElement).href) return;
        const childAny = child as unknown as Record<string, unknown>;
        elements.push({
          tag,
          type: (childAny.type as string | undefined) || undefined,
          text: (child.textContent ?? "").trim().slice(0, 80),
          role: child.getAttribute("role") || undefined,
          disabled: Boolean(childAny.disabled),
          href: tag === "a" ? child.getAttribute("href") || undefined : undefined,
          placeholder: (childAny.placeholder as string | undefined) || undefined,
        });
      });

      const className = (el as HTMLElement).className || "";
      const classStr = typeof className === "string" ? className : "";
      results.push({
        selector: classStr
          ? `.${classStr.split(/\s+/).slice(0, 2).join(".")}`
          : el.tagName.toLowerCase(),
        heading: headingText,
        type,
        visibleText,
        tableColumns,
        tableRowCount,
        elements,
      });
    });

    // Dedupe: drop sections whose visibleText is a prefix-match of a longer
    // sibling (nested containers tend to repeat the same content).
    const deduped = results.filter((s, i) => {
      const key = s.visibleText.slice(0, 60);
      if (!key) return false;
      return !results.some(
        (other, j) =>
          i !== j &&
          other.visibleText.length > s.visibleText.length &&
          other.visibleText.startsWith(key),
      );
    });

    return deduped;
  });

  // Cast to our typed shape (Playwright evaluate is `unknown`-typed when the
  // generic isn't inferred from the page-side closure).
  return raw as ObservedSection[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
