import type { Project } from "@specgen/server";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { projectsApi } from "../../api/client.js";
import { Button } from "../../components/ui/Button.js";

type AuthType = "none" | "cookie" | "header" | "basic" | "form" | "localStorage";

interface CaptureCfg {
  baseUrl: string;
  authType: AuthType;
  maxItems?: number;
  timeoutPerPageSec?: number;
  extraCookies?: ExtraCookie[];
}

interface ExtraCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

interface FormAuthInputs {
  loginUrl: string;
  usernameSelector: string;
  passwordSelector: string;
  submitSelector: string;
  usernameValue: string;
  passwordValue: string;
  postLoginUrlContains: string;
}

interface BasicAuthInputs {
  username: string;
  password: string;
}

interface CookieRow {
  name: string;
  value: string;
  domain: string;
  path: string;
}

interface HeaderRow {
  name: string;
  value: string;
}

interface LocalStorageRow {
  key: string;
  value: string;
}

const DEFAULT_CFG: CaptureCfg = {
  baseUrl: "",
  authType: "none",
  maxItems: 50,
  timeoutPerPageSec: 15,
};

function readCfg(p: Project): CaptureCfg {
  const raw = (p.connectors as { capture?: Partial<CaptureCfg> }).capture ?? {};
  return {
    baseUrl: raw.baseUrl ?? "",
    authType: (raw.authType as AuthType) ?? "none",
    maxItems: raw.maxItems ?? DEFAULT_CFG.maxItems,
    timeoutPerPageSec: raw.timeoutPerPageSec ?? DEFAULT_CFG.timeoutPerPageSec,
    extraCookies: Array.isArray(raw.extraCookies) ? raw.extraCookies : [],
  };
}

const EMPTY_FORM: FormAuthInputs = {
  loginUrl: "",
  usernameSelector: "input[name='username']",
  passwordSelector: "input[name='password']",
  submitSelector: "button[type='submit']",
  usernameValue: "",
  passwordValue: "",
  postLoginUrlContains: "",
};

export function CaptureTab() {
  const { slug } = useParams<{ slug: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [cfg, setCfg] = useState<CaptureCfg>(DEFAULT_CFG);
  const [tokenSet, setTokenSet] = useState(false);
  const [authSummary, setAuthSummary] = useState<Record<string, unknown> | null>(null);
  const [formAuth, setFormAuth] = useState<FormAuthInputs>(EMPTY_FORM);
  const [basicAuth, setBasicAuth] = useState<BasicAuthInputs>({ username: "", password: "" });
  const [cookieRows, setCookieRows] = useState<CookieRow[]>([
    { name: "", value: "", domain: "", path: "/" },
  ]);
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>([{ name: "", value: "" }]);
  const [lsRows, setLsRows] = useState<LocalStorageRow[]>([{ key: "", value: "" }]);
  const [busy, setBusy] = useState<null | "save" | "token" | "test">(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [probeResult, setProbeResult] = useState<{
    ok: boolean;
    baseUrlReachable: boolean;
    authApplied: boolean;
    finalUrl: string | null;
    pageTitle: string | null;
    status: number | null;
    authType: string;
    error: string | null;
    warnings: string[];
  } | null>(null);

  useEffect(() => {
    if (!slug) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function refresh() {
    if (!slug) return;
    try {
      const [p, tokensRes, summaryRes] = await Promise.all([
        projectsApi.get(slug),
        fetch(`/api/v0/projects/${slug}/tokens`).then((r) =>
          r.ok ? (r.json() as Promise<Array<{ provider: string }>>) : [],
        ),
        fetch(`/api/v0/projects/${slug}/capture/auth-summary`).then((r) =>
          r.ok ? (r.json() as Promise<Record<string, unknown>>) : null,
        ),
      ]);
      setProject(p);
      setCfg(readCfg(p));
      setTokenSet(tokensRes.some((t) => t.provider === "capture-auth"));
      setAuthSummary(summaryRes);
      hydrateFormsFromSummary(summaryRes);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /**
   * Populate the auth-specific form inputs from the redacted summary so the
   * user sees what's already saved INSIDE the inputs themselves — selectors,
   * URLs, usernames, cookie names, header names, localStorage keys all
   * visible; secret values left blank with a "saved — re-type to replace"
   * placeholder driven by `tokenSet`.
   */
  function hydrateFormsFromSummary(s: Record<string, unknown> | null) {
    if (!s || !s.configured) return;
    const t = String(s.authType ?? "");
    if (t === "form") {
      setFormAuth({
        loginUrl: String(s.loginUrl ?? ""),
        usernameSelector: String(s.usernameSelector ?? EMPTY_FORM.usernameSelector),
        passwordSelector: String(s.passwordSelector ?? EMPTY_FORM.passwordSelector),
        submitSelector: String(s.submitSelector ?? EMPTY_FORM.submitSelector),
        usernameValue: String(s.usernameValue ?? ""),
        passwordValue: "",
        postLoginUrlContains: String(s.postLoginUrlContains ?? ""),
      });
    } else if (t === "basic") {
      setBasicAuth({ username: String(s.username ?? ""), password: "" });
    } else if (t === "cookie" && Array.isArray(s.cookies)) {
      const rows = (s.cookies as Array<Record<string, unknown>>).map((c) => ({
        name: String(c.name ?? ""),
        value: "",
        domain: String(c.domain ?? ""),
        path: String(c.path ?? ""),
      }));
      setCookieRows(rows.length > 0 ? rows : [{ name: "", value: "", domain: "", path: "/" }]);
    } else if (t === "header" && Array.isArray(s.headers)) {
      const rows = (s.headers as Array<Record<string, unknown>>).map((h) => ({
        name: String(h.name ?? ""),
        value: "",
      }));
      setHeaderRows(rows.length > 0 ? rows : [{ name: "", value: "" }]);
    } else if (t === "localStorage" && Array.isArray(s.entries)) {
      const rows = (s.entries as Array<Record<string, unknown>>).map((e) => ({
        key: String(e.key ?? ""),
        value: "",
      }));
      setLsRows(rows.length > 0 ? rows : [{ key: "", value: "" }]);
    }
  }

  /** Build the inline auth payload from the current form state (no save needed). */
  function buildAuthFromForm(): unknown {
    if (cfg.authType === "form") {
      const post = formAuth.postLoginUrlContains.trim();
      return {
        type: "form",
        loginUrl: formAuth.loginUrl,
        usernameSelector: formAuth.usernameSelector,
        passwordSelector: formAuth.passwordSelector,
        submitSelector: formAuth.submitSelector,
        usernameValue: formAuth.usernameValue,
        passwordValue: formAuth.passwordValue,
        ...(post ? { postLoginUrlContains: post } : {}),
      };
    }
    if (cfg.authType === "basic") {
      return { type: "basic", username: basicAuth.username, password: basicAuth.password };
    }
    if (cfg.authType === "cookie") {
      return {
        type: "cookie",
        cookies: cookieRows
          .filter((c) => c.name && c.value)
          .map((c) => ({
            name: c.name,
            value: c.value,
            ...(c.domain ? { domain: c.domain } : {}),
            ...(c.path ? { path: c.path } : {}),
          })),
      };
    }
    if (cfg.authType === "header") {
      const headers: Record<string, string> = {};
      for (const h of headerRows) if (h.name && h.value) headers[h.name] = h.value;
      return { type: "header", headers };
    }
    if (cfg.authType === "localStorage") {
      return {
        type: "localStorage",
        entries: lsRows.filter((e) => e.key).map((e) => ({ key: e.key, value: e.value })),
      };
    }
    return { type: "none" };
  }

  async function testCapture() {
    if (!slug) return;
    setBusy("test");
    setError(null);
    setInfo(null);
    setProbeResult(null);
    try {
      // Send the live form state — no save required. Server uses the body
      // when present, falls back to the saved config otherwise.
      const validExtraCookies = (cfg.extraCookies ?? []).filter((c) => c.name && c.value);
      const body = {
        baseUrl: cfg.baseUrl,
        auth: buildAuthFromForm(),
        ...(cfg.timeoutPerPageSec ? { timeoutPerPageSec: cfg.timeoutPerPageSec } : {}),
        ...(validExtraCookies.length > 0 ? { extraCookies: validExtraCookies } : {}),
      };
      const res = await fetch(`/api/v0/projects/${slug}/capture/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const result = (await res.json()) as typeof probeResult;
      setProbeResult(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveCfg() {
    if (!slug || !project) return;
    setBusy("save");
    setError(null);
    setInfo(null);
    try {
      const nextConnectors = {
        ...(project.connectors as Record<string, unknown>),
        capture: {
          baseUrl: cfg.baseUrl,
          authType: cfg.authType,
          maxItems: cfg.maxItems,
          timeoutPerPageSec: cfg.timeoutPerPageSec,
          extraCookies: (cfg.extraCookies ?? []).filter((c) => c.name && c.value),
        },
      };
      const updated = await projectsApi.update(slug, { connectors: nextConnectors });
      setProject(updated);
      setInfo("Capture settings saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveToken() {
    if (!slug) return;
    setBusy("token");
    setError(null);
    setInfo(null);
    try {
      let auth: unknown;
      if (cfg.authType === "form") {
        const post = formAuth.postLoginUrlContains.trim();
        auth = {
          type: "form",
          loginUrl: formAuth.loginUrl,
          usernameSelector: formAuth.usernameSelector,
          passwordSelector: formAuth.passwordSelector,
          submitSelector: formAuth.submitSelector,
          usernameValue: formAuth.usernameValue,
          passwordValue: formAuth.passwordValue,
          ...(post ? { postLoginUrlContains: post } : {}),
        };
      } else if (cfg.authType === "basic") {
        auth = { type: "basic", username: basicAuth.username, password: basicAuth.password };
      } else if (cfg.authType === "cookie") {
        auth = {
          type: "cookie",
          cookies: cookieRows
            .filter((c) => c.name && c.value)
            .map((c) => ({
              name: c.name,
              value: c.value,
              ...(c.domain ? { domain: c.domain } : {}),
              ...(c.path ? { path: c.path } : {}),
            })),
        };
      } else if (cfg.authType === "header") {
        const headers: Record<string, string> = {};
        for (const h of headerRows) {
          if (h.name && h.value) headers[h.name] = h.value;
        }
        auth = { type: "header", headers };
      } else if (cfg.authType === "localStorage") {
        auth = {
          type: "localStorage",
          entries: lsRows.filter((e) => e.key).map((e) => ({ key: e.key, value: e.value })),
        };
      } else {
        // "none" — delete the token instead of saving anything
        const del = await fetch(`/api/v0/projects/${slug}/tokens/capture-auth`, {
          method: "DELETE",
        });
        if (!del.ok && del.status !== 404) {
          throw new Error(`HTTP ${del.status}: ${await del.text()}`);
        }
        setTokenSet(false);
        setInfo("Auth set to none — capture-auth token cleared.");
        return;
      }
      const res = await fetch(`/api/v0/projects/${slug}/tokens/capture-auth`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "capture-auth", auth }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      setTokenSet(true);
      // Clear secret fields after save so they don't sit in DOM memory
      if (cfg.authType === "form") {
        setFormAuth((s) => ({ ...s, passwordValue: "" }));
      }
      if (cfg.authType === "basic") {
        setBasicAuth((s) => ({ ...s, password: "" }));
      }
      if (cfg.authType === "cookie") {
        setCookieRows((rows) => rows.map((r) => ({ ...r, value: "" })));
      }
      if (cfg.authType === "header") {
        setHeaderRows((rows) => rows.map((r) => ({ ...r, value: "" })));
      }
      if (cfg.authType === "localStorage") {
        setLsRows((rows) => rows.map((r) => ({ ...r, value: "" })));
      }
      // Refresh the summary so the inline "saved — re-type to replace" hints
      // reflect what was just stored.
      void refresh();
      setInfo("Capture credentials saved (encrypted at rest).");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (!project) return <div className="text-stone-500 dark:text-stone-400">Loading…</div>;

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h2 className="text-lg font-medium mb-1 text-stone-900 dark:text-stone-100">
          Frontend page capture
        </h2>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Run a headless Chromium against your frontend and attach a screenshot + observed network
          calls to each parsed page. Auth credentials are stored encrypted at rest in the connector
          token store, never alongside the project row.
        </p>
      </div>

      <section className="space-y-3">
        <div>
          <label
            htmlFor="capture-base-url"
            className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
          >
            Base URL
          </label>
          <input
            id="capture-base-url"
            type="text"
            value={cfg.baseUrl}
            onChange={(e) => setCfg((c) => ({ ...c, baseUrl: e.target.value }))}
            placeholder="http://host.docker.internal:3000"
            className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded text-sm font-mono"
          />
          <p className="text-xs text-stone-500 dark:text-stone-400 mt-1">
            Inside Docker, use <code>http://host.docker.internal:&lt;port&gt;</code> to reach a
            frontend running on your host machine. The compose file already adds the required
            host-gateway alias.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="capture-max-items"
              className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
            >
              Max items / run
            </label>
            <input
              id="capture-max-items"
              type="number"
              min={1}
              max={500}
              value={cfg.maxItems ?? 50}
              onChange={(e) =>
                setCfg((c) => ({ ...c, maxItems: Number(e.target.value) || undefined }))
              }
              className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm"
            />
          </div>
          <div>
            <label
              htmlFor="capture-timeout"
              className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
            >
              Timeout / page (sec)
            </label>
            <input
              id="capture-timeout"
              type="number"
              min={1}
              max={120}
              value={cfg.timeoutPerPageSec ?? 15}
              onChange={(e) =>
                setCfg((c) => ({
                  ...c,
                  timeoutPerPageSec: Number(e.target.value) || undefined,
                }))
              }
              className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm"
            />
          </div>
        </div>

        {/* Extra cookies — applied regardless of the chosen authType. Use when
            your SPA needs both a primary auth (e.g. localStorage api_key) AND a
            server-issued session cookie. */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-stone-700 dark:text-stone-300">
            Extra cookies{" "}
            <span className="font-normal text-stone-500 dark:text-stone-500">
              — applied alongside whichever auth type you pick
            </span>
          </div>
          {(cfg.extraCookies ?? []).map((row: ExtraCookie, i: number) => (
            <div key={i} className="grid grid-cols-4 gap-2">
              <input
                type="text"
                placeholder="name"
                value={row.name}
                onChange={(e) => {
                  const next = [...(cfg.extraCookies ?? [])];
                  next[i] = { ...next[i], name: e.target.value };
                  setCfg((c) => ({ ...c, extraCookies: next }));
                }}
                className="px-2 py-1 text-sm font-mono border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded"
              />
              <input
                type="text"
                placeholder="value"
                value={row.value}
                onChange={(e) => {
                  const next = [...(cfg.extraCookies ?? [])];
                  next[i] = { ...next[i], value: e.target.value };
                  setCfg((c) => ({ ...c, extraCookies: next }));
                }}
                className="px-2 py-1 text-sm font-mono border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded"
              />
              <input
                type="text"
                placeholder="domain (auto)"
                value={row.domain ?? ""}
                onChange={(e) => {
                  const next = [...(cfg.extraCookies ?? [])];
                  next[i] = { ...next[i], domain: e.target.value };
                  setCfg((c) => ({ ...c, extraCookies: next }));
                }}
                className="px-2 py-1 text-sm font-mono border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded"
              />
              <button
                type="button"
                onClick={() => {
                  const next = [...(cfg.extraCookies ?? [])];
                  next.splice(i, 1);
                  setCfg((c) => ({ ...c, extraCookies: next }));
                }}
                className="text-xs text-stone-500 dark:text-stone-400 hover:text-red-600 dark:hover:text-red-400"
              >
                remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setCfg((c) => ({
                ...c,
                extraCookies: [...(c.extraCookies ?? []), { name: "", value: "" }],
              }))
            }
            className="text-xs text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 underline"
          >
            + add cookie
          </button>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Domain defaults to the base URL's hostname when blank.
          </p>
        </div>

        <div>
          <label
            htmlFor="capture-auth-type"
            className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
          >
            Authentication
          </label>
          <select
            id="capture-auth-type"
            value={cfg.authType}
            onChange={(e) => setCfg((c) => ({ ...c, authType: e.target.value as AuthType }))}
            className="px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm"
          >
            <option value="none">None (public frontend)</option>
            <option value="cookie">Cookie</option>
            <option value="header">Header (e.g. Bearer token)</option>
            <option value="basic">HTTP Basic</option>
            <option value="form">Form login</option>
            <option value="localStorage">localStorage</option>
          </select>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button type="button" disabled={busy !== null} onClick={() => void saveCfg()}>
            {busy === "save" ? "Saving…" : "Save settings"}
          </Button>
          <Button
            type="button"
            variant="brand"
            disabled={busy !== null || !cfg.baseUrl}
            onClick={() => void testCapture()}
            title="Verify baseUrl is reachable and configured auth works — no screenshots, no spec writes"
          >
            {busy === "test" ? "Testing…" : "Test connection"}
          </Button>
        </div>

        {probeResult && (
          <div
            className={`rounded border p-3 text-sm ${
              probeResult.ok
                ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300"
                : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300"
            }`}
          >
            <div className="font-medium mb-1">
              {probeResult.ok ? "✓ Connection ok" : "✗ Connection failed"}
            </div>
            <ul className="text-xs space-y-0.5">
              <li>
                Auth ({probeResult.authType}): {probeResult.authApplied ? "applied" : "failed"}
              </li>
              <li>
                Base URL:{" "}
                {probeResult.baseUrlReachable
                  ? `reachable (HTTP ${probeResult.status})`
                  : `unreachable${probeResult.status !== null ? ` (HTTP ${probeResult.status})` : ""}`}
              </li>
              {probeResult.finalUrl && (
                <li>
                  Landed on: <code className="font-mono">{probeResult.finalUrl}</code>
                </li>
              )}
              {probeResult.pageTitle && (
                <li>
                  Page title: <span className="italic">"{probeResult.pageTitle}"</span>
                </li>
              )}
              {probeResult.error && (
                <li>
                  Error: <span>{probeResult.error}</span>
                </li>
              )}
              {probeResult.warnings.length > 0 && (
                <li>Warnings: {probeResult.warnings.join("; ")}</li>
              )}
            </ul>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Auth-type-specific credential forms                                 */}
      {/* ------------------------------------------------------------------ */}
      {cfg.authType !== "none" && (
        <section className="space-y-3 border-t border-stone-200 dark:border-stone-800 pt-6">
          <div>
            <h3 className="text-base font-medium text-stone-900 dark:text-stone-100">
              Credentials
            </h3>
            <p className="text-xs text-stone-500 dark:text-stone-400">
              Saved into the encrypted token store. Plaintext fields are cleared from the DOM after
              save.
            </p>
          </div>

          {cfg.authType === "form" && (
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="form-login-url"
                  className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
                >
                  Login URL
                </label>
                <input
                  id="form-login-url"
                  type="text"
                  value={formAuth.loginUrl}
                  onChange={(e) => setFormAuth((s) => ({ ...s, loginUrl: e.target.value }))}
                  placeholder="http://host.docker.internal:3000/login"
                  className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm font-mono"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="form-user-sel"
                    className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
                  >
                    Username selector
                  </label>
                  <input
                    id="form-user-sel"
                    type="text"
                    value={formAuth.usernameSelector}
                    onChange={(e) =>
                      setFormAuth((s) => ({ ...s, usernameSelector: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm font-mono"
                  />
                </div>
                <div>
                  <label
                    htmlFor="form-pass-sel"
                    className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
                  >
                    Password selector
                  </label>
                  <input
                    id="form-pass-sel"
                    type="text"
                    value={formAuth.passwordSelector}
                    onChange={(e) =>
                      setFormAuth((s) => ({ ...s, passwordSelector: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm font-mono"
                  />
                </div>
                <div>
                  <label
                    htmlFor="form-submit-sel"
                    className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
                  >
                    Submit selector
                  </label>
                  <input
                    id="form-submit-sel"
                    type="text"
                    value={formAuth.submitSelector}
                    onChange={(e) => setFormAuth((s) => ({ ...s, submitSelector: e.target.value }))}
                    className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="form-user-val"
                    className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
                  >
                    Username{" "}
                    <span className="text-stone-400 dark:text-stone-600 font-normal">
                      (optional)
                    </span>
                  </label>
                  <input
                    id="form-user-val"
                    type="text"
                    value={formAuth.usernameValue}
                    onChange={(e) => setFormAuth((s) => ({ ...s, usernameValue: e.target.value }))}
                    autoComplete="off"
                    placeholder="leave blank for password-only login"
                    className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="form-pass-val"
                    className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
                  >
                    Password
                  </label>
                  <input
                    id="form-pass-val"
                    type="password"
                    value={formAuth.passwordValue}
                    onChange={(e) => setFormAuth((s) => ({ ...s, passwordValue: e.target.value }))}
                    autoComplete="off"
                    placeholder={tokenSet ? "Saved — re-type to replace" : ""}
                    className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="form-post-login"
                  className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
                >
                  Post-login URL contains (optional)
                </label>
                <input
                  id="form-post-login"
                  type="text"
                  value={formAuth.postLoginUrlContains}
                  onChange={(e) =>
                    setFormAuth((s) => ({ ...s, postLoginUrlContains: e.target.value }))
                  }
                  placeholder="/dashboard"
                  className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm font-mono"
                />
              </div>
            </div>
          )}

          {cfg.authType === "basic" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="basic-user"
                  className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
                >
                  Username
                </label>
                <input
                  id="basic-user"
                  type="text"
                  value={basicAuth.username}
                  onChange={(e) => setBasicAuth((s) => ({ ...s, username: e.target.value }))}
                  autoComplete="off"
                  className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm"
                />
              </div>
              <div>
                <label
                  htmlFor="basic-pass"
                  className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
                >
                  Password
                </label>
                <input
                  id="basic-pass"
                  type="password"
                  value={basicAuth.password}
                  onChange={(e) => setBasicAuth((s) => ({ ...s, password: e.target.value }))}
                  autoComplete="off"
                  placeholder={tokenSet ? "Saved — re-type to replace" : ""}
                  className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm"
                />
              </div>
            </div>
          )}

          {cfg.authType === "cookie" && (
            <div className="space-y-2">
              {cookieRows.map((row, i) => (
                <div key={`cookie-${i}`} className="grid grid-cols-[1fr_2fr_1fr_1fr_auto] gap-2">
                  <input
                    type="text"
                    placeholder="name"
                    value={row.name}
                    onChange={(e) => {
                      const next = [...cookieRows];
                      next[i] = { ...row, name: e.target.value };
                      setCookieRows(next);
                    }}
                    className="px-2 py-1.5 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm font-mono"
                  />
                  <input
                    type="text"
                    placeholder={
                      (authSummary?.cookies as Array<{ valueSaved?: boolean }> | undefined)?.[i]
                        ?.valueSaved
                        ? "saved — re-type to replace"
                        : "value"
                    }
                    value={row.value}
                    onChange={(e) => {
                      const next = [...cookieRows];
                      next[i] = { ...row, value: e.target.value };
                      setCookieRows(next);
                    }}
                    className="px-2 py-1.5 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded text-sm font-mono"
                  />
                  <input
                    type="text"
                    placeholder="domain"
                    value={row.domain}
                    onChange={(e) => {
                      const next = [...cookieRows];
                      next[i] = { ...row, domain: e.target.value };
                      setCookieRows(next);
                    }}
                    className="px-2 py-1.5 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm font-mono"
                  />
                  <input
                    type="text"
                    placeholder="path"
                    value={row.path}
                    onChange={(e) => {
                      const next = [...cookieRows];
                      next[i] = { ...row, path: e.target.value };
                      setCookieRows(next);
                    }}
                    className="px-2 py-1.5 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm font-mono"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => setCookieRows((rows) => rows.filter((_, j) => j !== i))}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() =>
                  setCookieRows((rows) => [...rows, { name: "", value: "", domain: "", path: "/" }])
                }
              >
                + Add cookie
              </Button>
            </div>
          )}

          {cfg.authType === "header" && (
            <div className="space-y-2">
              {headerRows.map((row, i) => (
                <div key={`header-${i}`} className="grid grid-cols-[1fr_2fr_auto] gap-2">
                  <input
                    type="text"
                    placeholder="Header name"
                    value={row.name}
                    onChange={(e) => {
                      const next = [...headerRows];
                      next[i] = { ...row, name: e.target.value };
                      setHeaderRows(next);
                    }}
                    className="px-2 py-1.5 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm font-mono"
                  />
                  <input
                    type="text"
                    placeholder={
                      (authSummary?.headers as Array<{ valueSaved?: boolean }> | undefined)?.[i]
                        ?.valueSaved
                        ? "saved — re-type to replace"
                        : "value (e.g. Bearer eyJ…)"
                    }
                    value={row.value}
                    onChange={(e) => {
                      const next = [...headerRows];
                      next[i] = { ...row, value: e.target.value };
                      setHeaderRows(next);
                    }}
                    className="px-2 py-1.5 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded text-sm font-mono"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => setHeaderRows((rows) => rows.filter((_, j) => j !== i))}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => setHeaderRows((rows) => [...rows, { name: "", value: "" }])}
              >
                + Add header
              </Button>
            </div>
          )}

          {cfg.authType === "localStorage" && (
            <div className="space-y-2">
              {lsRows.map((row, i) => (
                <div key={`ls-${i}`} className="grid grid-cols-[1fr_2fr_auto] gap-2">
                  <input
                    type="text"
                    placeholder="key"
                    value={row.key}
                    onChange={(e) => {
                      const next = [...lsRows];
                      next[i] = { ...row, key: e.target.value };
                      setLsRows(next);
                    }}
                    className="px-2 py-1.5 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm font-mono"
                  />
                  <input
                    type="text"
                    placeholder={
                      (authSummary?.entries as Array<{ valueSaved?: boolean }> | undefined)?.[i]
                        ?.valueSaved
                        ? "saved — re-type to replace"
                        : "value (JSON-serializable)"
                    }
                    value={row.value}
                    onChange={(e) => {
                      const next = [...lsRows];
                      next[i] = { ...row, value: e.target.value };
                      setLsRows(next);
                    }}
                    className="px-2 py-1.5 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded text-sm font-mono"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => setLsRows((rows) => rows.filter((_, j) => j !== i))}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => setLsRows((rows) => [...rows, { key: "", value: "" }])}
              >
                + Add entry
              </Button>
            </div>
          )}

          <div className="pt-2">
            <Button type="button" disabled={busy !== null} onClick={() => void saveToken()}>
              {busy === "token" ? "Saving…" : tokenSet ? "Replace credentials" : "Save credentials"}
            </Button>
            {tokenSet && (
              <span className="ml-3 text-xs text-stone-500 dark:text-stone-400">
                A capture-auth token is configured.
              </span>
            )}
          </div>
        </section>
      )}

      {(error || info) && (
        <div
          role="alert"
          className={`text-sm rounded p-3 ${
            error
              ? "bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
              : "bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
          }`}
        >
          {error ?? info}
        </div>
      )}
    </div>
  );
}
