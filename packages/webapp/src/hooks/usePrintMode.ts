/**
 * usePrintMode — reads `?print=1` from the URL and toggles `body.print` so the
 * print stylesheet (`print.css`) can hide chrome (sidebar/header/buttons) for
 * Puppeteer-driven PDF export.
 *
 * Phase D fast-follow v0.2, Task F.2. Pairs with SpecPage's effect that flips
 * `window.__SPECGEN_PRINT_READY__ = true` once fonts are ready — PdfService
 * waits for that flag before snapping the PDF.
 */
import { useEffect, useState } from "react";

export function usePrintMode(): boolean {
  const [isPrint] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("print") === "1";
  });

  useEffect(() => {
    if (isPrint) document.body.classList.add("print");
    else document.body.classList.remove("print");
    return () => {
      document.body.classList.remove("print");
    };
  }, [isPrint]);

  return isPrint;
}
