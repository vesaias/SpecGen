/**
 * Public types for the @specgen/parser-frontend-capture package.
 *
 * `captureFrontend` is a post-parse augmenter — it takes the FrontendItems a
 * normal parser produced, opens each one in a Playwright-driven Chromium, and
 * records a screenshot + the network/DOM observations for the page.
 */

// ---------------------------------------------------------------------------
// Input: the minimal shape of a FrontendItem we care about
// ---------------------------------------------------------------------------

/**
 * Minimal FrontendItem shape required by the capture pipeline. The core
 * `FrontendSpecItem` is a superset of this — we accept the narrower contract
 * here so the package never has to depend on the full spec union.
 */
export interface CaptureFrontendItem {
  id: string;
  route: string;
}

// ---------------------------------------------------------------------------
// Auth configuration
// ---------------------------------------------------------------------------

/**
 * Discriminated union of the supported auth modes. Anything more elaborate
 * (CAPTCHA, multi-step OAuth redirects, SSO) is explicitly out of scope.
 */
export type CaptureAuth =
  | { type: "none" }
  | {
      type: "cookie";
      cookies: Array<{
        name: string;
        value: string;
        domain?: string;
        path?: string;
      }>;
    }
  | { type: "header"; headers: Record<string, string> }
  | { type: "basic"; username: string; password: string }
  | {
      type: "form";
      loginUrl: string;
      usernameSelector: string;
      passwordSelector: string;
      submitSelector: string;
      usernameValue: string;
      passwordValue: string;
      /** When set, we wait for `page.url()` to contain this substring. */
      postLoginUrlContains?: string;
    }
  | {
      type: "localStorage";
      entries: Array<{ key: string; value: string }>;
    };

// ---------------------------------------------------------------------------
// CaptureConfig (per-run options)
// ---------------------------------------------------------------------------

export interface CaptureConfig {
  /** e.g. "http://host.docker.internal:3000" — must NOT end with a trailing slash. */
  baseUrl: string;
  auth?: CaptureAuth;
  /**
   * Cookies applied to every per-page context, INDEPENDENT of `auth`. Use when
   * the SPA needs both a primary auth method (e.g. localStorage api_key) AND
   * a server-issued session cookie that gates API requests. Each cookie's
   * domain defaults to the baseUrl's hostname when unset.
   */
  extraCookies?: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
  }>;
  /** Cap screenshots per run. Default 50 to avoid runaway costs / disk. */
  maxItems?: number;
  /** Max seconds per page (incl. networkidle wait). Default 15. */
  timeoutPerPageSec?: number;
  /**
   * Optional explicit path to the Chromium executable. When unset Playwright
   * will use its bundled driver (`playwright-core` only — install required
   * via `npx playwright install chromium` in the container) or the binary at
   * `PLAYWRIGHT_BROWSERS_PATH`. The frontend-capture generator threads
   * `process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` through here.
   */
  executablePath?: string;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ObservedApiCall {
  method: string;
  url: string;
  status: number;
}

export interface ObservedElement {
  tag: string;
  type?: string;
  text: string;
  role?: string;
  disabled: boolean;
  href?: string;
  placeholder?: string;
}

export interface ObservedSection {
  selector: string;
  heading: string;
  type: "card" | "table" | "chart" | "form" | "list" | "other";
  visibleText: string;
  tableColumns?: string[];
  tableRowCount?: number;
  elements: ObservedElement[];
}

export interface CaptureItemResult {
  itemId: string;
  /** Relative path to the screenshot under the output dir, e.g. "page-home.png". */
  screenshotPath?: string;
  observedApiCalls: ObservedApiCall[];
  observedSections: ObservedSection[];
  /** Page title at capture time. */
  title?: string;
  /** Populated when capture failed for this item. */
  error?: string;
  /** HTTP status of the page navigation itself (not API calls). null when nav threw. */
  navStatus?: number | null;
  /**
   * Heuristic auth-failure signal. True when the page navigation returned
   * 401/403 OR when a majority of observed XHR/fetch responses were 401/403.
   * Helps users distinguish "the page loaded but my creds are wrong" from
   * "everything's fine".
   */
  authLikelyFailed?: boolean;
  /** URL we asked Playwright to load (baseUrl + item.route). */
  requestedUrl?: string;
  /** URL we ACTUALLY landed on after SPA hydration. Differs from requestedUrl when a redirect fires. */
  landedUrl?: string;
  /** First H1/H2 on the landed page. "Application Board" vs "Job Feed" diagnoses routing mismatches at a glance. */
  landedH1?: string;
}

export interface CaptureResult {
  results: CaptureItemResult[];
  /** Top-level warnings (e.g. "auth login failed — captured pages as anonymous"). */
  warnings: string[];
}
