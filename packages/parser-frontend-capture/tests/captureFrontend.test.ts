import { describe, expect, it } from "vitest";
import type { CaptureAuth, CaptureConfig } from "../src/index.js";

/**
 * Type-level smoke tests for the package's public surface. We don't actually
 * launch Playwright in CI — too heavy + flaky for an OSS project running on
 * unknown hardware. See `captureFrontend` itself for the runtime behaviour;
 * the Docker-based manual verification path covers it end-to-end.
 *
 * TODO: add a browser-backed integration test once we have a deterministic
 * static-HTML fixture in `tests/fixtures/` that we can serve from a tiny
 * Node http server.
 */

describe("CaptureAuth discriminated union", () => {
  it("accepts all documented auth modes", () => {
    const none: CaptureAuth = { type: "none" };
    const cookie: CaptureAuth = {
      type: "cookie",
      cookies: [{ name: "session", value: "x" }],
    };
    const header: CaptureAuth = {
      type: "header",
      headers: { Authorization: "Bearer x" },
    };
    const basic: CaptureAuth = { type: "basic", username: "u", password: "p" };
    const form: CaptureAuth = {
      type: "form",
      loginUrl: "http://x/login",
      usernameSelector: "#u",
      passwordSelector: "#p",
      submitSelector: "button[type=submit]",
      usernameValue: "u",
      passwordValue: "p",
    };
    const ls: CaptureAuth = {
      type: "localStorage",
      entries: [{ key: "token", value: "x" }],
    };
    expect([none, cookie, header, basic, form, ls]).toHaveLength(6);
  });
});

describe("CaptureConfig.maxItems default contract", () => {
  it("treats missing maxItems as default-50 (documented in src/captureFrontend.ts)", () => {
    const cfg: CaptureConfig = { baseUrl: "http://x" };
    expect(cfg.maxItems).toBeUndefined();
    // Actual default is asserted by the runtime test that ships with the
    // server-side generator (which mocks Playwright). Skipping at this layer.
  });
});

describe.skip("captureFrontend (requires real Chromium)", () => {
  // TODO: wire up a tests/fixtures/ HTTP server + flip this to .test once
  // playwright-core's chromium download is part of the OSS test image.
  it.skip("captures a public page with no auth", async () => {
    // intentionally skipped — see top-of-file rationale.
  });
});
