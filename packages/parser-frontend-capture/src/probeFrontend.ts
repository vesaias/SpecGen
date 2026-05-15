/**
 * probeFrontend — auth-only dry-run for the Capture settings "Test connection".
 *
 * Verifies that:
 *   - baseUrl is reachable (DNS, TCP, HTTP)
 *   - configured auth (cookie/header/basic/form/localStorage) succeeds
 *   - the post-auth landing page returns a sane title (not an error page)
 *
 * Never takes screenshots, never walks DOM sections. Always closes the browser.
 * Never throws — errors are surfaced via `ok=false` + `error` string.
 */

import { type Browser, type BrowserContext, type LaunchOptions, chromium } from "playwright-core";
import type { CaptureConfig } from "./types.js";

export interface ProbeResult {
  /** True iff baseUrl was reachable AND any configured auth applied without error. */
  ok: boolean;
  /** True iff the browser loaded baseUrl with HTTP < 400. */
  baseUrlReachable: boolean;
  /** True iff form-login completed (or non-form auth, vacuously true). */
  authApplied: boolean;
  /** Final URL the browser landed on after auth + baseUrl navigation. */
  finalUrl: string | null;
  /** <title> of the landed page, useful to confirm "this looks like my app". */
  pageTitle: string | null;
  /** HTTP status of the baseUrl navigation. */
  status: number | null;
  /** Auth type from the config, for the UI to echo back. */
  authType: CaptureConfig["auth"] extends infer A
    ? A extends { type: infer T }
      ? T
      : never
    : never;
  /** One-line error message when ok=false. */
  error: string | null;
  /** Non-fatal hints (e.g. baseUrl had a trailing slash; we stripped it). */
  warnings: string[];
}

const DEFAULT_TIMEOUT_SEC = 15;

export async function probeFrontend(cfg: CaptureConfig): Promise<ProbeResult> {
  const warnings: string[] = [];
  const authType = (cfg.auth?.type ?? "none") as ProbeResult["authType"];
  const out: ProbeResult = {
    ok: false,
    baseUrlReachable: false,
    authApplied: false,
    finalUrl: null,
    pageTitle: null,
    status: null,
    authType,
    error: null,
    warnings,
  };

  const baseUrl = cfg.baseUrl.replace(/\/+$/, "");
  if (!baseUrl) {
    out.error = "baseUrl is empty";
    return out;
  }
  const timeoutMs = (cfg.timeoutPerPageSec ?? DEFAULT_TIMEOUT_SEC) * 1000;

  const launchOpts: LaunchOptions = { headless: true };
  if (cfg.executablePath) launchOpts.executablePath = cfg.executablePath;

  let browser: Browser;
  try {
    browser = await chromium.launch(launchOpts);
  } catch (err) {
    out.error = `chromium launch failed: ${(err as Error).message}`;
    return out;
  }

  try {
    const auth = cfg.auth ?? { type: "none" };

    // Form auth: prime a separate context, capture cookies.
    let formAuthStorage: Awaited<ReturnType<BrowserContext["storageState"]>> | null = null;
    if (auth.type === "form") {
      const primingCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await primingCtx.newPage();
        await page.goto(auth.loginUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        await page.fill(auth.usernameSelector, auth.usernameValue, { timeout: timeoutMs });
        await page.fill(auth.passwordSelector, auth.passwordValue, { timeout: timeoutMs });
        const navP = page
          .waitForLoadState("networkidle", { timeout: timeoutMs })
          .catch(() => undefined);
        await page.click(auth.submitSelector, { timeout: timeoutMs });
        if (auth.postLoginUrlContains) {
          const needle = auth.postLoginUrlContains;
          await page.waitForFunction((n) => location.href.includes(n), needle, {
            timeout: timeoutMs,
          });
        } else {
          await navP;
        }
        formAuthStorage = await primingCtx.storageState();
        out.authApplied = true;
      } catch (err) {
        out.error = `form login failed: ${(err as Error).message}`;
        await primingCtx.close().catch(() => undefined);
        return out;
      } finally {
        await primingCtx.close().catch(() => undefined);
      }
    } else {
      // No priming needed for other auth modes.
      out.authApplied = true;
    }

    // Real context with the chosen auth applied, then navigate to baseUrl.
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ...(auth.type === "basic"
        ? { httpCredentials: { username: auth.username, password: auth.password } }
        : {}),
      ...(formAuthStorage ? { storageState: formAuthStorage } : {}),
    });

    try {
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

      const page = await ctx.newPage();
      const resp = await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      out.status = resp?.status() ?? null;
      out.finalUrl = page.url();
      out.pageTitle = await page.title().catch(() => null);
      out.baseUrlReachable = out.status !== null && out.status < 400;
      out.ok = out.baseUrlReachable && out.authApplied;
      if (!out.baseUrlReachable && !out.error) {
        out.error = `baseUrl returned HTTP ${out.status ?? "?"}`;
      }
    } catch (err) {
      out.error = `navigation failed: ${(err as Error).message}`;
    } finally {
      await ctx.close().catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  return out;
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
