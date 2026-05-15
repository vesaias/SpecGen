import type { Project } from "@specgen/server";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { projectsApi } from "../../api/client.js";

type ParserMode = "rule-only" | "rule-plus-llm-fallback" | "llm-only";

function readParserMode(project: Project): ParserMode {
  const raw = (project.parserConfig as Record<string, unknown> | undefined)?.parserMode;
  if (raw === "rule-plus-llm-fallback" || raw === "llm-only") return raw;
  return "rule-only";
}

function readAutoPoll(project: Project): boolean {
  const cfg = (project.connectors as { github?: { autoPoll?: boolean } } | undefined)?.github;
  return cfg?.autoPoll === true;
}

export function SourceTab() {
  const { slug } = useParams<{ slug: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [mode, setMode] = useState<ParserMode>("rule-only");
  const [autoPoll, setAutoPoll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!slug) return;
    projectsApi.get(slug).then((p) => {
      setProject(p);
      setMode(readParserMode(p));
      setAutoPoll(readAutoPoll(p));
    });
  }, [slug]);

  if (!project) return <div className="text-stone-500 dark:text-stone-400">Loading…</div>;

  const sourceText =
    project.source.type === "local"
      ? project.source.localPath
      : `${project.source.owner}/${project.source.repo}@${project.source.ref}`;

  async function handleModeChange(next: ParserMode) {
    if (!slug || !project) return;
    setMode(next);
    setSaving(true);
    setError(null);
    try {
      const nextParserConfig = {
        ...(project.parserConfig as Record<string, unknown>),
        parserMode: next,
      };
      const updated = await projectsApi.update(slug, { parserConfig: nextParserConfig });
      setProject(updated);
      setSavedAt(Date.now());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAutoPollChange(next: boolean) {
    if (!slug || !project) return;
    setAutoPoll(next);
    setSaving(true);
    setError(null);
    try {
      const existing = (project.connectors as Record<string, unknown>) ?? {};
      const existingGithub = (existing.github as { autoPoll?: boolean } | undefined) ?? {};
      const nextConnectors = {
        ...existing,
        github: { ...existingGithub, autoPoll: next },
      };
      const updated = await projectsApi.update(slug, { connectors: nextConnectors });
      setProject(updated);
      setSavedAt(Date.now());
    } catch (err) {
      setError((err as Error).message);
      setAutoPoll(!next); // revert on failure
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="text-lg font-medium mb-4 text-stone-900 dark:text-stone-100">Source</h2>
      <div className="space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-500 mb-1">
            Type
          </div>
          <div className="font-mono text-sm text-stone-900 dark:text-stone-100">
            {project.source.type}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-500 mb-1">
            Source
          </div>
          <div className="font-mono text-sm break-all text-stone-900 dark:text-stone-100">
            {sourceText}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-500 mb-1">
            Parsers
          </div>
          <div className="font-mono text-sm text-stone-900 dark:text-stone-100">
            {project.parsers.length === 0 ? (
              <span className="text-stone-400 dark:text-stone-600">none configured</span>
            ) : (
              project.parsers.join(", ")
            )}
          </div>
        </div>

        <div className="pt-4">
          <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-500 mb-2">
            Parser mode
          </div>
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="parserMode"
                value="rule-only"
                checked={mode === "rule-only"}
                onChange={() => handleModeChange("rule-only")}
                disabled={saving}
                className="mt-0.5"
              />
              <span className="text-stone-900 dark:text-stone-100">
                <span className="font-medium">Rule only</span>
                <span className="text-stone-500 dark:text-stone-400">
                  {" "}
                  — default; only the built-in language parsers run.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="parserMode"
                value="rule-plus-llm-fallback"
                checked={mode === "rule-plus-llm-fallback"}
                onChange={() => handleModeChange("rule-plus-llm-fallback")}
                disabled={saving}
                className="mt-0.5"
              />
              <span className="text-stone-900 dark:text-stone-100">
                <span className="font-medium">Rule + AI fallback</span>
                <span className="text-stone-500 dark:text-stone-400">
                  {" "}
                  — rule parsers first, then AI fills gaps for files they missed. Adds AI cost (≈
                  $0.05 per repo with Haiku-class models).
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name="parserMode"
                value="llm-only"
                checked={mode === "llm-only"}
                onChange={() => handleModeChange("llm-only")}
                disabled={saving}
                className="mt-0.5"
              />
              <span className="text-stone-900 dark:text-stone-100">
                <span className="font-medium">AI only</span>
                <span className="text-stone-500 dark:text-stone-400">
                  {" "}
                  — skip the rule parsers, use the AI parser exclusively. Works for languages
                  without a dedicated rule parser; higher AI cost.
                </span>
              </span>
            </label>
          </div>
          {error && <div className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</div>}
          {savedAt && !error && (
            <div className="mt-2 text-xs text-stone-500 dark:text-stone-400">Saved.</div>
          )}
        </div>

        {project.source.type === "github" && (
          <div className="pt-4 border-t border-stone-200 dark:border-stone-800">
            <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-500 mb-2">
              Auto-poll
            </div>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={autoPoll}
                onChange={(e) => void handleAutoPollChange(e.target.checked)}
                disabled={saving}
                className="mt-0.5 rounded border-stone-300 dark:border-stone-700"
              />
              <span className="text-stone-900 dark:text-stone-100">
                <span className="font-medium">Check GitHub for new commits every 24h</span>
                <span className="text-stone-500 dark:text-stone-400 block mt-0.5 text-xs">
                  When the upstream branch moves, SpecGen automatically enqueues an Update run.
                  Requires a GitHub token in Settings → Connectors and an AI provider in Settings →
                  AI. Auto-push (if configured) chains afterward.
                </span>
              </span>
            </label>
          </div>
        )}

        <div className="text-xs text-stone-500 dark:text-stone-400 mt-4">
          Source editing arrives in a later phase. To re-detect parsers, click{" "}
          <strong>Update</strong> in the project topbar.
        </div>
      </div>
    </div>
  );
}
