import type { CreateProjectInput } from "@specgen/server";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { type ProviderInfo, aiApi } from "../api/aiApi.js";
import type {
  ClassifiedProject,
  DetectReport,
  LanguageInfo,
  ParserMatch,
  ParserRejection,
} from "../api/client.js";
import { projectsApi } from "../api/client.js";
import { type ProfileSummary, profilesApi } from "../api/profilesApi.js";
import { ModelPicker } from "../components/ai/ModelPicker.js";
import { ProviderRadio } from "../components/ai/ProviderRadio.js";
import { AppShell } from "../components/ui/AppShell.js";
import { Button } from "../components/ui/Button.js";

// ---------------------------------------------------------------------------
// DetectReportPanel
// ---------------------------------------------------------------------------

function DetectReportPanel({ report }: { report: DetectReport }) {
  const [rejectedOpen, setRejectedOpen] = useState(false);

  return (
    <div className="rounded border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 p-4 space-y-4 text-sm">
      {/* Suggested profile */}
      <div className="flex items-center gap-2">
        <span className="text-stone-500 dark:text-stone-400">Suggested profile:</span>
        <span className="font-medium text-stone-900 dark:text-stone-100">
          {report.suggestedProfile}
        </span>
      </div>

      {/* Matching parsers */}
      {report.matches.length > 0 && (
        <section>
          <h3 className="font-medium text-stone-700 dark:text-stone-300 mb-2">Parsers matched</h3>
          <ul className="space-y-1">
            {report.matches.map((m: ParserMatch) => (
              <li key={m.parser} className="flex items-center gap-2">
                <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300 font-mono">
                  {m.parser}
                </span>
                <span className="text-stone-500 dark:text-stone-400">
                  confidence {Math.round(m.confidence * 100)}%
                  {m.atSubdir ? ` — at ${m.atSubdir}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Rejected parsers (collapsed by default) */}
      {report.rejected.length > 0 && (
        <section>
          <button
            type="button"
            className="flex items-center gap-1 text-stone-500 dark:text-stone-400 hover:text-stone-700 dark:hover:text-stone-200 text-xs font-medium"
            onClick={() => setRejectedOpen((v) => !v)}
          >
            <span>{rejectedOpen ? "▾" : "▸"}</span>
            <span>
              {report.rejected.length} parser{report.rejected.length === 1 ? "" : "s"} rejected
            </span>
          </button>
          {rejectedOpen && (
            <ul className="mt-2 space-y-1.5">
              {report.rejected.map((r: ParserRejection) => (
                <li key={r.parser}>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 font-mono">
                    {r.parser}
                  </span>
                  <span className="text-stone-500 dark:text-stone-400 ml-2">{r.reason}</span>
                  <span className="text-stone-400 dark:text-stone-600 ml-1">
                    (looked at: {r.lookedAt.join(", ")})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* AI classification — best-effort, additive over the heuristic matches */}
      {report.aiClassification && (
        <section>
          <h3 className="font-medium text-stone-700 dark:text-stone-300 mb-2">AI classification</h3>
          {report.aiClassification.summary && (
            <p className="text-stone-500 dark:text-stone-400 mb-2">
              {report.aiClassification.summary}
            </p>
          )}
          {report.aiClassification.projects.length === 0 ? (
            <p className="text-stone-400 dark:text-stone-600 text-xs">
              AI returned no distinct project roots.
            </p>
          ) : (
            <ul className="space-y-2">
              {report.aiClassification.projects.map((p: ClassifiedProject, idx: number) => {
                // Compute which AI-suggested parsers were missed by the rule-based matches
                const matchedParserIds = new Set(report.matches.map((m) => m.parser));
                const missedByRules = p.suggestedParsers.filter((sp) => !matchedParserIds.has(sp));
                return (
                  <li
                    key={`${p.rootDir}-${idx}`}
                    className="rounded border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 p-2 space-y-1"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {p.kind && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-mono">
                          {p.kind}
                        </span>
                      )}
                      <span className="text-xs font-mono text-stone-700 dark:text-stone-300">
                        {p.rootDir || "/"}
                      </span>
                      {p.framework && (
                        <span className="text-xs text-stone-500 dark:text-stone-400">
                          {p.framework}
                        </span>
                      )}
                      <span className="text-xs text-stone-400 dark:text-stone-600">
                        confidence {Math.round(p.confidence * 100)}%
                      </span>
                    </div>
                    {p.notes && (
                      <div className="text-xs text-stone-500 dark:text-stone-400">{p.notes}</div>
                    )}
                    {p.suggestedParsers.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-stone-400 dark:text-stone-600">parsers:</span>
                        {p.suggestedParsers.map((sp) => (
                          <span
                            key={sp}
                            className="text-xs px-1.5 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-mono"
                          >
                            {sp}
                          </span>
                        ))}
                      </div>
                    )}
                    {missedByRules.length > 0 && (
                      <div className="text-xs text-amber-700 dark:text-amber-300">
                        Rule parser missed this — file an issue or use the AI parser when available
                        ({missedByRules.join(", ")}).
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* Languages detected */}
      {report.languagesDetected.length > 0 && (
        <section>
          <h3 className="font-medium text-stone-700 dark:text-stone-300 mb-2">
            Languages detected
          </h3>
          <ul className="space-y-1">
            {report.languagesDetected.map((l: LanguageInfo) => (
              <li key={l.language} className="flex items-center gap-2">
                <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-mono capitalize">
                  {l.language}
                </span>
                <span className="text-stone-500 dark:text-stone-400">{l.fileCount} files</span>
                {!l.parserAvailable && (
                  <span className="text-stone-400 dark:text-stone-600 text-xs">
                    no parser shipped
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Summary verdict */}
      {report.canParse ? (
        <div className="rounded bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-3 py-2">
          This source is parseable. Create the project to proceed.
        </div>
      ) : (
        <div className="rounded bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2">
          No parser matched this source. You can still create the project, but parsing will produce
          no output until a matching parser ships.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI defaults — mirrors AiTab.tsx's autoDetectDefault. Kept here so the
// wizard can pre-select a usable provider the moment the probe succeeds.
// ---------------------------------------------------------------------------

function autoDetectDefault(providers: ProviderInfo[]): string {
  // Prefer claude_code when configured; otherwise first configured non-local provider; otherwise empty.
  const claudeCode = providers.find((p) => p.id === "claude_code");
  if (claudeCode?.configured) return "claude_code";
  const firstConfigured = providers.find((p) => p.configured && p.id !== "local");
  return firstConfigured?.id ?? "";
}

// ---------------------------------------------------------------------------
// ProjectCreate wizard
// ---------------------------------------------------------------------------

export function ProjectCreate() {
  const navigate = useNavigate();

  // Basic fields
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<"local" | "github">("local");
  const [localPath, setLocalPath] = useState("");
  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubRef, setGithubRef] = useState("main");
  // GitHub PAT — used for the initial probe and then persisted via the token
  // store after the project is created (see handleCreate).
  const [githubToken, setGithubToken] = useState("");

  // Probe state
  const [probeReport, setProbeReport] = useState<DetectReport | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  // AI step state — only shown once probeReport.canParse is true.
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [aiLoaded, setAiLoaded] = useState(false);
  const [aiProfileId, setAiProfileId] = useState("pm-spec");
  const [aiProvider, setAiProvider] = useState("");
  const [aiModel, setAiModel] = useState("");

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazily load providers + profiles when the probe succeeds — no point
  // fetching the lists if the user never reaches the AI step.
  useEffect(() => {
    if (!probeReport?.canParse || aiLoaded) return;
    Promise.all([aiApi.listProviders(), profilesApi.list()])
      .then(([provs, profs]) => {
        setProviders(provs);
        setProfiles(profs);
        // Prefer the probe's suggested profile if present in the loaded list,
        // otherwise fall back to pm-spec.
        const suggested = probeReport.suggestedProfile;
        if (profs.some((p) => p.id === suggested)) {
          setAiProfileId(suggested);
        }
        const detected = autoDetectDefault(provs);
        setAiProvider(detected);
        // Auto-pick the first model for the detected provider so the user
        // doesn't have to click into the picker for the default to apply.
        if (detected) {
          const provider = provs.find((p) => p.id === detected);
          if (provider?.models[0]) setAiModel(provider.models[0].id);
        }
        setAiLoaded(true);
      })
      .catch((err) => setError((err as Error).message));
  }, [probeReport, aiLoaded]);

  function buildSource() {
    if (sourceType === "local") {
      return { type: "local" as const, localPath };
    }
    return {
      type: "github" as const,
      owner: githubOwner,
      repo: githubRepo,
      ref: githubRef,
      token: githubToken,
    };
  }

  // Reset probe result whenever source fields change
  function resetProbe() {
    if (probeReport !== null || probeError !== null) {
      setProbeReport(null);
      setProbeError(null);
      setAiLoaded(false);
    }
  }

  async function handleProbe(e: React.FormEvent) {
    e.preventDefault();
    setProbing(true);
    setProbeReport(null);
    setProbeError(null);
    try {
      const report = await projectsApi.probe({ source: buildSource() });
      setProbeReport(report);
    } catch (err) {
      setProbeError((err as Error).message);
    } finally {
      setProbing(false);
    }
  }

  // When the user switches provider, default-pick the first model for that
  // provider so users don't end up with an empty model on submit.
  function handleProviderChange(id: string) {
    setAiProvider(id);
    const provider = providers.find((p) => p.id === id);
    setAiModel(provider?.models[0]?.id ?? "");
  }

  async function handleCreate() {
    setSubmitting(true);
    setError(null);
    const input: CreateProjectInput = {
      name,
      source:
        sourceType === "local"
          ? { type: "local", localPath }
          : {
              type: "github",
              owner: githubOwner,
              repo: githubRepo,
              ref: githubRef,
            },
      ai: {
        profileId: aiProfileId,
        provider: aiProvider,
        model: aiModel,
      },
    };
    try {
      const project = await projectsApi.create(input);

      // For GitHub sources: persist the PAT the user pasted in the probe step,
      // so the first parse run doesn't immediately fail with "token required".
      if (sourceType === "github" && githubToken.trim()) {
        try {
          const res = await fetch(
            `/api/v0/projects/${encodeURIComponent(project.slug)}/tokens/github`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                provider: "github",
                token: githubToken.trim(),
                label: `${githubOwner}/${githubRepo}`,
              }),
            },
          );
          if (!res.ok) {
            // Best-effort: warn but don't block the redirect.
            console.warn("Token save failed:", res.status, await res.text());
          }
        } catch (tokenErr) {
          console.warn("Token save failed:", tokenErr);
        }
      }

      navigate(`/projects/${project.slug}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  // The "submit" on the form drives the probe step; create is triggered via buttons
  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!probeReport) {
      await handleProbe(e);
    } else {
      await handleCreate();
    }
  }

  const canCreate = Boolean(
    name && (sourceType === "local" ? localPath : githubOwner && githubRepo),
  );

  const inputClass =
    "w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 " +
    "text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 " +
    "rounded focus:outline-none focus:border-brand-400 dark:focus:border-brand-400";

  const primaryProvider = providers.find((p) => p.id === aiProvider);
  // Reveal the AI section as soon as the probe completes — even if no parser
  // matched. Users can still "Create anyway" with AI configured for future
  // re-parses once a matching parser ships or they fix the layout.
  const showAiSection = Boolean(probeReport);
  const noProviderConfigured =
    aiLoaded && !aiProvider && !providers.some((p) => p.configured && p.id !== "local");

  return (
    <AppShell
      maxWidth="screen-xl"
      left={
        <Link
          to="/"
          className="text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
        >
          ← Dashboard
        </Link>
      }
    >
      <div className="max-w-xl">
        <h1 className="text-2xl font-semibold mb-6 text-stone-900 dark:text-stone-100">
          New project
        </h1>
        <form onSubmit={handleFormSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label
              htmlFor="project-name"
              className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
            >
              Name
            </label>
            <input
              id="project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className={inputClass}
            />
          </div>

          {/* Source */}
          <fieldset>
            <legend className="block text-sm font-medium mb-2 text-stone-700 dark:text-stone-300">
              Source
            </legend>
            <div className="space-x-4 text-sm mb-3 text-stone-700 dark:text-stone-300">
              <label>
                <input
                  type="radio"
                  checked={sourceType === "local"}
                  onChange={() => {
                    setSourceType("local");
                    resetProbe();
                  }}
                />{" "}
                Local path
              </label>
              <label>
                <input
                  type="radio"
                  checked={sourceType === "github"}
                  onChange={() => {
                    setSourceType("github");
                    resetProbe();
                  }}
                />{" "}
                GitHub
              </label>
            </div>

            {sourceType === "local" ? (
              <input
                type="text"
                placeholder="/path/to/project"
                value={localPath}
                onChange={(e) => {
                  setLocalPath(e.target.value);
                  resetProbe();
                }}
                required
                className={inputClass}
              />
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    placeholder="owner"
                    value={githubOwner}
                    onChange={(e) => {
                      setGithubOwner(e.target.value);
                      resetProbe();
                    }}
                    required
                    className={inputClass}
                  />
                  <input
                    type="text"
                    placeholder="repo"
                    value={githubRepo}
                    onChange={(e) => {
                      setGithubRepo(e.target.value);
                      resetProbe();
                    }}
                    required
                    className={inputClass}
                  />
                  <input
                    type="text"
                    placeholder="ref"
                    value={githubRef}
                    onChange={(e) => {
                      setGithubRef(e.target.value);
                      resetProbe();
                    }}
                    className={inputClass}
                  />
                </div>
                <input
                  type="password"
                  placeholder="GitHub PAT"
                  value={githubToken}
                  onChange={(e) => {
                    setGithubToken(e.target.value);
                    resetProbe();
                  }}
                  required
                  className={`${inputClass} text-sm`}
                />
                <p className="text-xs text-stone-400 dark:text-stone-600">
                  Used for the parser probe and saved encrypted on project create. Edit later in
                  Settings &rarr; Connectors.
                </p>
              </div>
            )}
          </fieldset>

          {/* Probe result panel */}
          {probeReport && <DetectReportPanel report={probeReport} />}

          {/* AI configuration — revealed once probe succeeds */}
          {showAiSection && (
            <section className="space-y-4 border-t border-stone-200 dark:border-stone-800 pt-4">
              <h2 className="text-base font-medium text-stone-900 dark:text-stone-100">
                AI configuration
              </h2>
              {!aiLoaded ? (
                <div className="text-sm text-stone-500 dark:text-stone-400">Loading providers…</div>
              ) : (
                <>
                  {/* Profile picker */}
                  <div className="space-y-1">
                    <label
                      htmlFor="ai-profile"
                      className="block text-sm font-medium text-stone-700 dark:text-stone-300"
                    >
                      Profile
                    </label>
                    <select
                      id="ai-profile"
                      value={aiProfileId}
                      onChange={(e) => setAiProfileId(e.target.value)}
                      className="font-mono text-sm bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 border border-stone-300 dark:border-stone-700 rounded px-2 py-1"
                    >
                      {profiles.length === 0 && <option value={aiProfileId}>{aiProfileId}</option>}
                      {profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id} — {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* No-provider warning — non-blocking, lets the user proceed
                      and configure later via Settings → AI. */}
                  {noProviderConfigured && (
                    <div className="rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 text-amber-900 dark:text-amber-200 px-3 py-2 text-sm">
                      No AI provider available — set{" "}
                      <code className="font-mono">CLAUDE_CODE_OAUTH_TOKEN</code> or{" "}
                      <code className="font-mono">ANTHROPIC_API_KEY</code>, then refresh. The
                      project will be created but Update/Rebuild won't work until AI is configured.
                    </div>
                  )}

                  {/* Provider radio */}
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-stone-700 dark:text-stone-300">
                      Provider
                    </div>
                    <ProviderRadio
                      providers={providers}
                      value={aiProvider}
                      onChange={handleProviderChange}
                    />
                  </div>

                  {/* Model picker — shown once a provider is selected */}
                  {aiProvider && (
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-stone-700 dark:text-stone-300">
                        Model
                      </div>
                      <ModelPicker
                        models={primaryProvider?.models ?? []}
                        value={aiModel}
                        onChange={setAiModel}
                        subscriptionBased={primaryProvider?.subscriptionBased}
                      />
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {/* Errors */}
          {probeError && <div className="text-sm text-red-600 dark:text-red-400">{probeError}</div>}
          {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap">
            {!probeReport ? (
              /* Step 1: Check compatibility */
              <Button type="submit" variant="primary" disabled={probing || !canCreate}>
                {probing ? "Checking…" : "Check compatibility"}
              </Button>
            ) : probeReport.canParse ? (
              /* Step 2a: parseable → primary Create */
              <Button
                type="button"
                variant="primary"
                disabled={submitting}
                onClick={() => void handleCreate()}
              >
                {submitting ? "Creating…" : "Create project"}
              </Button>
            ) : (
              /* Step 2b: not parseable → danger Create anyway */
              <Button
                type="button"
                variant="danger"
                disabled={submitting}
                onClick={() => void handleCreate()}
              >
                {submitting ? "Creating…" : "Create anyway"}
              </Button>
            )}

            {/* Re-check button once a report is shown */}
            {probeReport && (
              <Button
                type="button"
                variant="secondary"
                disabled={probing}
                onClick={(e) => void handleProbe(e as unknown as React.FormEvent)}
              >
                Re-check
              </Button>
            )}

            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
