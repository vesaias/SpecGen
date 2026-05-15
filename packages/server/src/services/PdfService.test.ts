/**
 * PdfService tests. Two cases:
 *   1. throws cleanly when CHROME_HEADLESS_SHELL_PATH is unset (unit, no browser)
 *   2. renders a trivial data URL to a real PDF — gated on chrome being present
 *      via existsSync(CHROME_HEADLESS_SHELL_PATH), so CI without Chromium skips it.
 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PdfService } from "./PdfService.js";

const CHROME = process.env.CHROME_HEADLESS_SHELL_PATH;
const hasChrome = Boolean(CHROME && existsSync(CHROME));

describe("PdfService", () => {
  it("throws when CHROME_HEADLESS_SHELL_PATH is not set", async () => {
    const prev = process.env.CHROME_HEADLESS_SHELL_PATH;
    // biome-ignore lint/performance/noDelete: assigning undefined to process.env stringifies to literal "undefined"
    delete process.env.CHROME_HEADLESS_SHELL_PATH;
    const svc = new PdfService();
    try {
      await expect(svc.render({ url: "data:text/html,hi" })).rejects.toThrow(
        /CHROME_HEADLESS_SHELL_PATH/,
      );
    } finally {
      if (prev) process.env.CHROME_HEADLESS_SHELL_PATH = prev;
    }
  });

  it.skipIf(!hasChrome)(
    "renders a trivial HTML data URL to PDF (PDF magic bytes)",
    async () => {
      const svc = new PdfService({ executablePath: CHROME });
      try {
        const buf = await svc.render({
          url: `data:text/html,${encodeURIComponent(
            "<html><body><script>window.__SPECGEN_PRINT_READY__=true</script>hi</body></html>",
          )}`,
        });
        expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
      } finally {
        await svc.shutdown();
      }
    },
    30_000,
  );
});
