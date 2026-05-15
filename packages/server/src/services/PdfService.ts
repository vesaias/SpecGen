import PQueue from "p-queue";
/**
 * PdfService — Puppeteer-based PDF renderer (Phase D fast-follow v0.2, Task F.1).
 *
 * Drives `puppeteer-core` against the running webapp at `?print=1`. The webapp
 * sets `window.__SPECGEN_PRINT_READY__ = true` once fonts are loaded and the
 * page has mounted; we wait for that flag before calling `page.pdf()`.
 *
 * Chromium is supplied by `chrome-headless-shell` (installed via
 * `@puppeteer/browsers` in the production Docker image). The path is read
 * from the `CHROME_HEADLESS_SHELL_PATH` env var unless overridden in opts.
 *
 * The renderer keeps a single persistent browser instance to amortize launch
 * cost (~300ms cold start). Each render uses a fresh BrowserContext for
 * isolation, and the browser is recycled every N renders (default 50) to
 * bleed any leaked memory.
 *
 * Concurrency is capped via `p-queue` (default 2) — Chromium hard-spikes RAM
 * per active page; 2 is the documented safe-ish ceiling for a 1GB container.
 */
import puppeteer, { type Browser } from "puppeteer-core";

export interface PdfServiceOpts {
  /** Path to chrome-headless-shell binary. Defaults to env CHROME_HEADLESS_SHELL_PATH. */
  executablePath?: string;
  /** Max concurrent renders. Default 2. */
  concurrency?: number;
  /** Recycle the browser after N renders to bleed memory. Default 50. */
  recycleAfter?: number;
}

export interface PdfRenderOpts {
  url: string;
  /** Paper format. Default A4. */
  format?: "A4" | "Letter" | "Legal";
  /** Header HTML in Puppeteer template format. */
  headerTemplate?: string;
  /** Footer HTML in Puppeteer template format. */
  footerTemplate?: string;
  /** Wait up to ms for window.__SPECGEN_PRINT_READY__ before printing. Default 30000. */
  readyTimeoutMs?: number;
}

export class PdfService {
  private browser: Browser | null = null;
  private renderCount = 0;
  private readonly queue: PQueue;

  constructor(private readonly opts: PdfServiceOpts = {}) {
    this.queue = new PQueue({ concurrency: opts.concurrency ?? 2 });
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.connected) return this.browser;
    const executablePath = this.opts.executablePath ?? process.env.CHROME_HEADLESS_SHELL_PATH;
    if (!executablePath) {
      throw new Error(
        "PdfService: CHROME_HEADLESS_SHELL_PATH not set — install chrome-headless-shell and point this env var at the binary",
      );
    }
    this.browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    return this.browser;
  }

  /**
   * Render the given URL to a PDF buffer. Serializes via the internal queue
   * (concurrency 2 by default). Each call gets a fresh BrowserContext so
   * cookies / localStorage / service workers do not leak between renders.
   */
  async render(opts: PdfRenderOpts): Promise<Buffer> {
    const result = await this.queue.add(async () => {
      const browser = await this.ensureBrowser();
      const context = await browser.createBrowserContext();
      try {
        const page = await context.newPage();
        await page.goto(opts.url, { waitUntil: "networkidle0", timeout: 60_000 });
        // The function below runs inside Chromium, not Node — `globalThis`
        // there is `window`. Using `globalThis` keeps the TS DTS build happy
        // (the server tsconfig does not include the DOM lib).
        await page.waitForFunction(
          () =>
            (globalThis as { __SPECGEN_PRINT_READY__?: boolean }).__SPECGEN_PRINT_READY__ === true,
          { timeout: opts.readyTimeoutMs ?? 30_000 },
        );
        const displayHeaderFooter = Boolean(opts.headerTemplate || opts.footerTemplate);
        const buf = await page.pdf({
          format: opts.format ?? "A4",
          printBackground: true,
          margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
          displayHeaderFooter,
          headerTemplate: opts.headerTemplate ?? "<div></div>",
          footerTemplate: opts.footerTemplate ?? "<div></div>",
        });
        this.renderCount++;
        if (this.renderCount >= (this.opts.recycleAfter ?? 50)) {
          await this.recycleBrowser();
        }
        return Buffer.from(buf);
      } finally {
        await context.close().catch(() => undefined);
      }
    });
    if (!result) {
      // p-queue can return undefined if the task was cancelled; surface
      // explicitly rather than handing the caller `undefined as Buffer`.
      throw new Error("PdfService: render was cancelled");
    }
    return result;
  }

  private async recycleBrowser(): Promise<void> {
    const old = this.browser;
    this.browser = null;
    this.renderCount = 0;
    await old?.close().catch(() => undefined);
  }

  /** Gracefully close the browser. Safe to call when no browser is running. */
  async shutdown(): Promise<void> {
    await this.recycleBrowser();
  }
}
