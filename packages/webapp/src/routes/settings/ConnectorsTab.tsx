import type { Project } from "@specgen/server";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { projectsApi } from "../../api/client.js";
import { ProgressDrawer } from "../../components/runs/ProgressDrawer.js";
import { Button } from "../../components/ui/Button.js";

interface GitDocsCfg {
  cloneUrl: string;
  targetBranch: string;
  docsRoot: string;
  overwriteStrategy: "force" | "halt";
  /**
   * When true the server's auto-push listener fires this push automatically
   * after every successful enrichment-pipeline / full-tree-spec run. Default
   * false — opt-in per project. See server/src/services/autoPushOnRunComplete.ts.
   */
  autoPush: boolean;
}

interface GitDocsState {
  project_id: string;
  last_pushed_sha: string | null;
  last_source_sha: string | null;
  last_run_id: string | null;
  last_pushed_at: string | null;
}

interface ConfluenceCfg {
  spaceKey: string;
  parentPageId: string;
  /** Non-secret. Persisted on project.connectors.confluence so the form can
   * show it back after save instead of clearing to empty. */
  baseUrl: string;
  /** Non-secret. Same reason as baseUrl. */
  email: string;
  /** Auto-trigger this push after every successful enrichment run. Opt-in. */
  autoPush: boolean;
}

interface ConfluenceTokenInputs {
  apiToken: string;
}

interface ConfluenceState {
  live: number;
  tombstoned: number;
  lastSyncedAt: string | null;
}

function relativeTime(iso: string): string {
  if (!iso) return "unknown";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const DEFAULT_CFG: GitDocsCfg = {
  cloneUrl: "",
  targetBranch: "specgen-docs",
  docsRoot: "docs",
  overwriteStrategy: "halt",
  autoPush: false,
};

const DEFAULT_CONFLUENCE_CFG: ConfluenceCfg = {
  spaceKey: "",
  parentPageId: "",
  baseUrl: "",
  email: "",
  autoPush: false,
};

function readCfg(p: Project): GitDocsCfg {
  const raw = (p.connectors as { gitDocs?: Partial<GitDocsCfg> }).gitDocs ?? {};
  return {
    cloneUrl: raw.cloneUrl ?? "",
    targetBranch: raw.targetBranch ?? DEFAULT_CFG.targetBranch,
    docsRoot: raw.docsRoot ?? DEFAULT_CFG.docsRoot,
    overwriteStrategy: raw.overwriteStrategy ?? DEFAULT_CFG.overwriteStrategy,
    autoPush: raw.autoPush ?? DEFAULT_CFG.autoPush,
  };
}

function readConfluenceCfg(p: Project): ConfluenceCfg {
  const raw = (p.connectors as { confluence?: Partial<ConfluenceCfg> }).confluence ?? {};
  return {
    spaceKey: raw.spaceKey ?? "",
    parentPageId: raw.parentPageId ?? "",
    baseUrl: raw.baseUrl ?? "",
    email: raw.email ?? "",
    autoPush: raw.autoPush ?? DEFAULT_CONFLUENCE_CFG.autoPush,
  };
}

type BusyAction =
  | "save"
  | "token"
  | "push"
  | "confluence-save"
  | "confluence-token"
  | "confluence-test"
  | "confluence-push";

export function ConnectorsTab() {
  const { slug } = useParams<{ slug: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [cfg, setCfg] = useState<GitDocsCfg>(DEFAULT_CFG);
  const [token, setToken] = useState("");
  const [tokenSet, setTokenSet] = useState(false);
  const [state, setState] = useState<GitDocsState | null>(null);
  // Confluence section state
  const [confluenceCfg, setConfluenceCfg] = useState<ConfluenceCfg>(DEFAULT_CONFLUENCE_CFG);
  const [confluenceTokenInputs, setConfluenceTokenInputs] = useState<ConfluenceTokenInputs>({
    apiToken: "",
  });
  const [confluenceTokenSet, setConfluenceTokenSet] = useState(false);
  const [confluenceState, setConfluenceState] = useState<ConfluenceState | null>(null);
  const [busy, setBusy] = useState<null | BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Active run for the Confluence push — drives the ProgressDrawer. When set,
  // the drawer streams the run's events via SSE. Cleared when the user closes
  // it; that close handler also refreshes `confluenceState` so the status row
  // at the bottom of the tab reflects post-push reality.
  const [confluenceRunId, setConfluenceRunId] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    void refresh();
  }, [slug]);

  async function refresh() {
    if (!slug) return;
    try {
      const [p, stateRes, tokensRes, cfStateRes] = await Promise.all([
        projectsApi.get(slug),
        fetch(`/api/v0/projects/${slug}/git-docs/state`).then((r) =>
          r.ok ? (r.json() as Promise<GitDocsState | null>) : null,
        ),
        fetch(`/api/v0/projects/${slug}/tokens`).then((r) =>
          r.ok ? (r.json() as Promise<Array<{ provider: string }>>) : [],
        ),
        fetch(`/api/v0/projects/${slug}/confluence/state`).then((r) =>
          r.ok ? (r.json() as Promise<ConfluenceState>) : null,
        ),
      ]);
      setProject(p);
      setCfg(readCfg(p));
      setConfluenceCfg(readConfluenceCfg(p));
      setState(stateRes);
      setConfluenceState(cfStateRes);
      setTokenSet(tokensRes.some((t) => t.provider === "github"));
      setConfluenceTokenSet(tokensRes.some((t) => t.provider === "confluence"));
    } catch (err) {
      setError((err as Error).message);
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
        gitDocs: cfg,
      };
      const updated = await projectsApi.update(slug, { connectors: nextConnectors });
      setProject(updated);
      setInfo("Configuration saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Persist a single git-docs cfg field change immediately. Used by the
   * auto-push checkbox so the toggle takes effect on the very next enrichment
   * run, without forcing the user to find the Save button.
   */
  async function patchGitDocsCfg(patch: Partial<GitDocsCfg>) {
    if (!slug || !project) return;
    const next = { ...cfg, ...patch };
    setCfg(next);
    try {
      const nextConnectors = {
        ...(project.connectors as Record<string, unknown>),
        gitDocs: next,
      };
      const updated = await projectsApi.update(slug, { connectors: nextConnectors });
      setProject(updated);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveToken() {
    if (!slug || !token) return;
    setBusy("token");
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/v0/projects/${slug}/tokens/github`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "github", token }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      setToken("");
      setTokenSet(true);
      setInfo("Token saved (encrypted at rest).");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function pushDocs() {
    if (!slug) return;
    setBusy("push");
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/v0/projects/${slug}/git-docs/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as { pushedSha: string | null; filesWritten: number };
      setInfo(
        body.pushedSha
          ? `Pushed ${body.filesWritten} file(s) → ${body.pushedSha.slice(0, 7)}`
          : `Nothing to push (${body.filesWritten} file(s) re-rendered, no changes).`,
      );
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // -------------------------------------------------------------------------
  // Confluence handlers
  // -------------------------------------------------------------------------

  async function saveConfluenceToken() {
    if (!slug || !project) return;
    const { baseUrl, email } = confluenceCfg;
    const { apiToken } = confluenceTokenInputs;
    if (!baseUrl || !email || !apiToken) return;
    setBusy("confluence-token");
    setError(null);
    setInfo(null);
    try {
      // Token store: apiToken (encrypted). baseUrl + email travel with it
      // so server-side Confluence client has everything it needs.
      const res = await fetch(`/api/v0/projects/${slug}/tokens/confluence`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "confluence", baseUrl, email, apiToken }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

      // Project config: baseUrl + email persisted in the clear so the form
      // can show them back. apiToken stays only in the encrypted store.
      const nextConnectors = {
        ...(project.connectors as Record<string, unknown>),
        confluence: {
          ...(((project.connectors as Record<string, unknown>).confluence ?? {}) as object),
          baseUrl,
          email,
          spaceKey: confluenceCfg.spaceKey,
          autoPush: confluenceCfg.autoPush,
          ...(confluenceCfg.parentPageId ? { parentPageId: confluenceCfg.parentPageId } : {}),
        },
      };
      const updated = await projectsApi.update(slug, { connectors: nextConnectors });
      setProject(updated);
      setConfluenceTokenInputs({ apiToken: "" });
      setConfluenceTokenSet(true);
      setInfo("Confluence credentials saved (apiToken encrypted, base URL + email visible).");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveConfluenceCfg() {
    if (!slug || !project) return;
    setBusy("confluence-save");
    setError(null);
    setInfo(null);
    try {
      const nextConnectors = {
        ...(project.connectors as Record<string, unknown>),
        confluence: {
          ...(((project.connectors as Record<string, unknown>).confluence ?? {}) as object),
          spaceKey: confluenceCfg.spaceKey,
          autoPush: confluenceCfg.autoPush,
          // Preserve credentials persistance even when saving config-only.
          ...(confluenceCfg.baseUrl ? { baseUrl: confluenceCfg.baseUrl } : {}),
          ...(confluenceCfg.email ? { email: confluenceCfg.email } : {}),
          ...(confluenceCfg.parentPageId ? { parentPageId: confluenceCfg.parentPageId } : {}),
        },
      };
      const updated = await projectsApi.update(slug, {
        connectors: nextConnectors,
      });
      setProject(updated);
      setInfo("Confluence configuration saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /**
   * Immediate-save helper for confluence cfg — mirrors patchGitDocsCfg.
   * Used by the auto-push toggle so the change takes effect without forcing
   * the user to find the Save button.
   */
  async function patchConfluenceCfg(patch: Partial<ConfluenceCfg>) {
    if (!slug || !project) return;
    const next = { ...confluenceCfg, ...patch };
    setConfluenceCfg(next);
    try {
      const nextConnectors = {
        ...(project.connectors as Record<string, unknown>),
        confluence: {
          ...(((project.connectors as Record<string, unknown>).confluence ?? {}) as object),
          spaceKey: next.spaceKey,
          autoPush: next.autoPush,
          ...(next.baseUrl ? { baseUrl: next.baseUrl } : {}),
          ...(next.email ? { email: next.email } : {}),
          ...(next.parentPageId ? { parentPageId: next.parentPageId } : {}),
        },
      };
      const updated = await projectsApi.update(slug, { connectors: nextConnectors });
      setProject(updated);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function testConfluence() {
    if (!slug) return;
    setBusy("confluence-test");
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/v0/projects/${slug}/confluence/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as {
        ok: boolean;
        space: { id: string; key: string };
      };
      setInfo(`Connection ok — found space ${body.space.key} (${body.space.id}).`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function pushConfluence() {
    if (!slug) return;
    setBusy("confluence-push");
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/v0/projects/${slug}/confluence/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      // The route now enqueues a RunWorker run and returns 202 { runId }. We
      // open the ProgressDrawer mounted at the bottom of this component; it
      // subscribes to the run's SSE event stream and renders per-page
      // progress live. The status-row at the bottom of the tab refreshes
      // when the drawer closes.
      const body = (await res.json()) as { runId: string; status: string };
      setConfluenceRunId(body.runId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Refresh project + connector state whenever the user closes the run drawer.
  // The drawer surfaces `done`/`error` via its own UI; we only need to repaint
  // the persistent status row (live/tombstoned counts, lastSyncedAt).
  function closeConfluenceDrawer() {
    setConfluenceRunId(null);
    void refresh();
  }

  if (!project) return <div className="text-stone-500 dark:text-stone-400">Loading…</div>;

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h2 className="text-lg font-medium mb-1 text-stone-900 dark:text-stone-100">Connectors</h2>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Push the generated spec as Markdown to a Git repository on demand.
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* GitHub token                                                        */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-medium text-stone-900 dark:text-stone-100">GitHub token</h3>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Personal-access token with <code className="font-mono">repo</code> scope. Encrypted at
            rest with AES-256-GCM; never written to <code>.git/config</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="pat-input" className="sr-only">
            GitHub Personal Access Token
          </label>
          <input
            id="pat-input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={tokenSet ? "Token saved — paste a new one to replace" : "ghp_…"}
            className="flex-1 px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded text-sm font-mono"
            autoComplete="off"
          />
          <Button type="button" disabled={busy !== null || !token} onClick={() => void saveToken()}>
            {busy === "token" ? "Saving…" : tokenSet ? "Replace" : "Save token"}
          </Button>
        </div>
        {tokenSet && (
          <div className="text-xs text-stone-500 dark:text-stone-400">
            A GitHub token is configured.
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Git /docs push                                                      */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-medium text-stone-900 dark:text-stone-100">
            Git /docs push
          </h3>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Materializes the spec as Markdown under <code>{cfg.docsRoot || "docs"}</code> and pushes
            to <code>{cfg.targetBranch || "specgen-docs"}</code>.
          </p>
        </div>

        <div>
          <label
            htmlFor="cloneUrl"
            className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
          >
            Clone URL
          </label>
          <input
            id="cloneUrl"
            type="text"
            value={cfg.cloneUrl}
            onChange={(e) => setCfg((c) => ({ ...c, cloneUrl: e.target.value }))}
            placeholder="https://github.com/owner/repo.git"
            className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded text-sm font-mono"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="targetBranch"
              className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
            >
              Branch
            </label>
            <input
              id="targetBranch"
              type="text"
              value={cfg.targetBranch}
              onChange={(e) => setCfg((c) => ({ ...c, targetBranch: e.target.value }))}
              className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded text-sm font-mono"
            />
          </div>
          <div>
            <label
              htmlFor="docsRoot"
              className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
            >
              Docs root
            </label>
            <input
              id="docsRoot"
              type="text"
              value={cfg.docsRoot}
              onChange={(e) => setCfg((c) => ({ ...c, docsRoot: e.target.value }))}
              className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded text-sm font-mono"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="overwriteStrategy"
            className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
          >
            Conflict strategy
          </label>
          <select
            id="overwriteStrategy"
            value={cfg.overwriteStrategy}
            onChange={(e) =>
              setCfg((c) => ({
                ...c,
                overwriteStrategy: e.target.value as "force" | "halt",
              }))
            }
            className="px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm"
          >
            <option value="halt">halt (refuse if remote drifted)</option>
            <option value="force">force (reset hard to remote, then push)</option>
          </select>
        </div>

        {/* Auto-push toggle — fires this push automatically after every
            enrichment-pipeline / full-tree-spec run. Persisted immediately
            on toggle so the change takes effect on the next run without a
            Save click. */}
        <div className="flex items-center gap-2 pt-1">
          <input
            id="gitdocs-autopush"
            type="checkbox"
            checked={cfg.autoPush}
            onChange={(e) => void patchGitDocsCfg({ autoPush: e.target.checked })}
            className="rounded border-stone-300 dark:border-stone-700"
          />
          <label htmlFor="gitdocs-autopush" className="text-sm text-stone-700 dark:text-stone-300">
            Auto-push after every enrichment run
          </label>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button type="button" disabled={busy !== null} onClick={() => void saveCfg()}>
            {busy === "save" ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="brand"
            disabled={busy !== null || !cfg.cloneUrl || !tokenSet}
            onClick={() => void pushDocs()}
          >
            {busy === "push" ? "Pushing…" : "Push docs"}
          </Button>
        </div>

        {/* Status row */}
        <div className="text-xs text-stone-600 dark:text-stone-400 border-t border-stone-200 dark:border-stone-800 pt-3 space-y-1">
          {state?.last_pushed_sha ? (
            <>
              <div>
                Last pushed: <span className="font-mono">{state.last_pushed_sha.slice(0, 7)}</span>{" "}
                <span className="text-stone-400 dark:text-stone-600">
                  {relativeTime(state.last_pushed_at ?? "")}
                </span>
              </div>
              {state.last_run_id && (
                <div>
                  Run: <span className="font-mono">{state.last_run_id}</span>
                </div>
              )}
            </>
          ) : (
            <div className="text-stone-400 dark:text-stone-600">No pushes yet.</div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Confluence push                                                     */}
      {/* ------------------------------------------------------------------ */}
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-medium text-stone-900 dark:text-stone-100">
            Confluence push
          </h3>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            Two-pass sync of each spec item to a Confluence Cloud space via the REST API v2. Pages
            persist in the <code>confluence_page_map</code> table so re-syncs update in place.
            Removed items are archived (soft delete — reversible from Confluence trash).
          </p>
        </div>

        {/* Credentials form */}
        <div className="space-y-2">
          <div>
            <label
              htmlFor="cf-base-url"
              className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
            >
              Confluence base URL
            </label>
            <input
              id="cf-base-url"
              type="text"
              value={confluenceCfg.baseUrl}
              onChange={(e) => setConfluenceCfg((c) => ({ ...c, baseUrl: e.target.value }))}
              placeholder="https://acme.atlassian.net"
              className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded text-sm font-mono"
              aria-label="Confluence base URL"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="cf-email"
                className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
              >
                Atlassian account email
              </label>
              <input
                id="cf-email"
                type="email"
                value={confluenceCfg.email}
                onChange={(e) => setConfluenceCfg((c) => ({ ...c, email: e.target.value }))}
                placeholder="bot@acme.com"
                className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded text-sm font-mono"
                aria-label="Atlassian account email"
                autoComplete="off"
              />
            </div>
            <div>
              <label
                htmlFor="cf-api-token"
                className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
              >
                API token
              </label>
              <input
                id="cf-api-token"
                type="password"
                value={confluenceTokenInputs.apiToken}
                onChange={(e) =>
                  setConfluenceTokenInputs((c) => ({
                    ...c,
                    apiToken: e.target.value,
                  }))
                }
                placeholder={
                  confluenceTokenSet ? "Token saved — paste a new one to replace" : "ATATT…"
                }
                className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded text-sm font-mono"
                aria-label="Confluence API token"
                autoComplete="off"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              disabled={
                busy !== null ||
                !confluenceCfg.baseUrl ||
                !confluenceCfg.email ||
                !confluenceTokenInputs.apiToken
              }
              onClick={() => void saveConfluenceToken()}
            >
              {busy === "confluence-token"
                ? "Saving…"
                : confluenceTokenSet
                  ? "Replace credentials"
                  : "Save credentials"}
            </Button>
            {confluenceTokenSet && (
              <span className="text-xs text-stone-500 dark:text-stone-400">
                A Confluence token is configured.
              </span>
            )}
          </div>
        </div>

        {/* Space config form */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <div>
            <label
              htmlFor="cf-space-key"
              className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
            >
              Space key
            </label>
            <input
              id="cf-space-key"
              type="text"
              value={confluenceCfg.spaceKey}
              onChange={(e) => setConfluenceCfg((c) => ({ ...c, spaceKey: e.target.value }))}
              placeholder="DEMO"
              className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded text-sm font-mono"
              aria-label="Confluence space key"
            />
          </div>
          <div>
            <label
              htmlFor="cf-parent-page-id"
              className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
            >
              Parent page id (optional)
            </label>
            <input
              id="cf-parent-page-id"
              type="text"
              value={confluenceCfg.parentPageId}
              onChange={(e) => setConfluenceCfg((c) => ({ ...c, parentPageId: e.target.value }))}
              placeholder="123456789"
              className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded text-sm font-mono"
              aria-label="Confluence parent page id"
            />
          </div>
        </div>

        {/* Auto-push toggle — same semantics as the git-docs version. */}
        <div className="flex items-center gap-2 pt-1">
          <input
            id="confluence-autopush"
            type="checkbox"
            checked={confluenceCfg.autoPush}
            onChange={(e) => void patchConfluenceCfg({ autoPush: e.target.checked })}
            className="rounded border-stone-300 dark:border-stone-700"
          />
          <label
            htmlFor="confluence-autopush"
            className="text-sm text-stone-700 dark:text-stone-300"
          >
            Auto-push after every enrichment run
          </label>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button type="button" disabled={busy !== null} onClick={() => void saveConfluenceCfg()}>
            {busy === "confluence-save" ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            disabled={busy !== null || !confluenceTokenSet || !confluenceCfg.spaceKey}
            onClick={() => void testConfluence()}
          >
            {busy === "confluence-test" ? "Testing…" : "Test connection"}
          </Button>
          <Button
            type="button"
            variant="brand"
            disabled={busy !== null || !confluenceTokenSet || !confluenceCfg.spaceKey}
            onClick={() => void pushConfluence()}
          >
            {busy === "confluence-push" ? "Starting…" : "Push to Confluence"}
          </Button>
        </div>

        {/* Status row */}
        <div className="text-xs text-stone-600 dark:text-stone-400 border-t border-stone-200 dark:border-stone-800 pt-3 space-y-1">
          {confluenceState && confluenceState.live + confluenceState.tombstoned > 0 ? (
            <>
              <div>
                Pages: <span className="font-mono">{confluenceState.live}</span> live,{" "}
                <span className="font-mono">{confluenceState.tombstoned}</span> archived
              </div>
              {confluenceState.lastSyncedAt && (
                <div>
                  Last synced:{" "}
                  <span className="text-stone-400 dark:text-stone-600">
                    {relativeTime(confluenceState.lastSyncedAt)}
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="text-stone-400 dark:text-stone-600">No pages synced yet.</div>
          )}
        </div>
      </section>

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

      {/* Confluence push run drawer — only visible when a push is in flight. */}
      <ProgressDrawer runId={confluenceRunId} onClose={closeConfluenceDrawer} />
    </div>
  );
}
