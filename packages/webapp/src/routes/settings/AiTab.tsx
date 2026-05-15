import type { Project } from "@specgen/server";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { type ProviderInfo, aiApi } from "../../api/aiApi.js";
import { projectsApi } from "../../api/client.js";
import { type ProfileSummary, profilesApi } from "../../api/profilesApi.js";
import { BaseUrlField } from "../../components/ai/BaseUrlField.js";
import { FallbackSection } from "../../components/ai/FallbackSection.js";
import { GuidelinesEditor } from "../../components/ai/GuidelinesEditor.js";
import { ModelPicker } from "../../components/ai/ModelPicker.js";
import { ProviderRadio } from "../../components/ai/ProviderRadio.js";
import { TestProfileButton } from "../../components/ai/TestProfileButton.js";
import { Button } from "../../components/ui/Button.js";

interface AiState {
  profileId: string;
  provider: string;
  model: string;
  baseUrl: string;
  temperature: number;
  maxTokens: number;
  concurrency: number;
  outputLang: string;
  guidelines: string;
  fallbackProvider: string;
  fallbackModel: string;
  fallbackBaseUrl: string;
}

const DEFAULTS: AiState = {
  profileId: "pm-spec",
  provider: "",
  model: "",
  baseUrl: "",
  temperature: 0.2,
  maxTokens: 8000,
  concurrency: 3,
  outputLang: "en",
  guidelines: "",
  fallbackProvider: "",
  fallbackModel: "",
  fallbackBaseUrl: "",
};

function autoDetectDefault(providers: ProviderInfo[]): string {
  // Prefer claude_code when configured; otherwise first configured non-local provider; otherwise empty.
  const claudeCode = providers.find((p) => p.id === "claude_code");
  if (claudeCode?.configured) return "claude_code";
  const firstConfigured = providers.find((p) => p.configured && p.id !== "local");
  return firstConfigured?.id ?? "";
}

export function AiTab() {
  const { slug } = useParams<{ slug: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [state, setState] = useState<AiState>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!slug) return;
    Promise.all([projectsApi.get(slug), aiApi.listProviders(), profilesApi.list()])
      .then(([p, provs, profs]) => {
        setProject(p);
        setProviders(provs);
        setProfiles(profs);
        const ai = (p.ai as Record<string, unknown> | undefined) ?? {};
        setState({
          profileId: (ai.profileId as string) ?? "pm-spec",
          provider: (ai.provider as string) ?? autoDetectDefault(provs),
          model: (ai.model as string) ?? "",
          baseUrl: (ai.baseUrl as string) ?? "",
          temperature: (ai.temperature as number) ?? 0.2,
          maxTokens: (ai.maxTokens as number) ?? 8000,
          concurrency: (ai.concurrency as number) ?? 3,
          outputLang: (ai.outputLang as string) ?? "en",
          guidelines: (ai.guidelines as string) ?? "",
          fallbackProvider: (ai.fallbackProvider as string) ?? "",
          fallbackModel: (ai.fallbackModel as string) ?? "",
          fallbackBaseUrl: (ai.fallbackBaseUrl as string) ?? "",
        });
        setLoaded(true);
      })
      .catch((err) => setError((err as Error).message));
  }, [slug]);

  function patchState(patch: Partial<AiState>) {
    setState((s) => ({ ...s, ...patch }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug) return;
    setSaving(true);
    setError(null);
    try {
      await projectsApi.update(slug, {
        ai: {
          profileId: state.profileId,
          provider: state.provider,
          model: state.model,
          baseUrl: state.baseUrl || undefined,
          temperature: state.temperature,
          maxTokens: state.maxTokens,
          concurrency: state.concurrency,
          outputLang: state.outputLang,
          guidelines: state.guidelines || undefined,
          fallbackProvider: state.fallbackProvider || undefined,
          fallbackModel: state.fallbackModel || undefined,
          fallbackBaseUrl: state.fallbackBaseUrl || undefined,
        },
      });
      setSavedAt(Date.now());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!loaded || !project)
    return <div className="text-stone-500 dark:text-stone-400">Loading…</div>;

  const primary = providers.find((p) => p.id === state.provider);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <h2 className="text-lg font-medium text-stone-900 dark:text-stone-100">AI</h2>

      <section className="space-y-3">
        <div className="text-sm font-medium text-stone-700 dark:text-stone-300">Profile</div>
        <div className="flex items-center gap-3">
          <select
            value={state.profileId}
            onChange={(e) => patchState({ profileId: e.target.value })}
            className="font-mono text-sm bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 border border-stone-300 dark:border-stone-700 rounded px-2 py-1"
          >
            {profiles.length === 0 && <option value={state.profileId}>{state.profileId}</option>}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} — {p.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-stone-500 dark:text-stone-400">
            Selected profile drives prompt templates for AI enrichment.
            <a className="ml-2 underline" href={`/projects/${slug}/profiles`}>
              Browse / fork
            </a>
          </span>
        </div>
      </section>

      <section className="space-y-3">
        <div className="text-sm font-medium text-stone-700 dark:text-stone-300">Provider</div>
        <ProviderRadio
          providers={providers}
          value={state.provider}
          onChange={(id) => patchState({ provider: id, model: "" })}
        />
      </section>

      {state.provider && (
        <section className="space-y-3">
          <div className="text-sm font-medium text-stone-700 dark:text-stone-300">Model</div>
          <ModelPicker
            models={primary?.models ?? []}
            value={state.model}
            onChange={(id) => patchState({ model: id })}
            subscriptionBased={primary?.subscriptionBased}
          />
        </section>
      )}

      {(state.provider === "openai_compat" ||
        state.provider === "ollama" ||
        primary?.requiresBaseUrl) && (
        <section>
          <BaseUrlField
            value={state.baseUrl}
            onChange={(v) => patchState({ baseUrl: v })}
            placeholder={
              state.provider === "ollama" ? "http://localhost:11434" : "https://api.together.ai/v1"
            }
            helper={
              state.provider === "ollama"
                ? "Defaults to http://localhost:11434 if blank"
                : "OpenAI-compatible API endpoint (Together, Groq, Anyscale, etc.)"
            }
          />
        </section>
      )}

      <section className="grid grid-cols-3 gap-4">
        <div>
          <label
            htmlFor="temp"
            className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
          >
            Temperature
          </label>
          <input
            id="temp"
            type="number"
            step={0.1}
            min={0}
            max={2}
            value={state.temperature}
            onChange={(e) => patchState({ temperature: Number.parseFloat(e.target.value) })}
            className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="maxt"
            className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
          >
            Max tokens
          </label>
          <input
            id="maxt"
            type="number"
            min={100}
            value={state.maxTokens}
            onChange={(e) => patchState({ maxTokens: Number.parseInt(e.target.value, 10) })}
            className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm"
          />
        </div>
        <div>
          <label
            htmlFor="conc"
            className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
          >
            Concurrency
          </label>
          <input
            id="conc"
            type="number"
            min={1}
            max={10}
            value={state.concurrency}
            onChange={(e) => patchState({ concurrency: Number.parseInt(e.target.value, 10) })}
            className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm"
          />
        </div>
      </section>

      <section>
        <label
          htmlFor="lang"
          className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
        >
          Output language
        </label>
        <input
          id="lang"
          type="text"
          value={state.outputLang}
          onChange={(e) => patchState({ outputLang: e.target.value })}
          placeholder="en"
          className="w-32 px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm"
        />
      </section>

      <section>
        <GuidelinesEditor
          value={state.guidelines}
          onChange={(v) => patchState({ guidelines: v })}
        />
      </section>

      <section>
        <FallbackSection
          providers={providers}
          fallbackProvider={state.fallbackProvider}
          fallbackModel={state.fallbackModel}
          fallbackBaseUrl={state.fallbackBaseUrl}
          onChange={(patch) => patchState(patch)}
        />
      </section>

      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <TestProfileButton slug={slug ?? ""} label="Test profile" />
        {savedAt && <span className="text-sm text-stone-500 dark:text-stone-400">Saved.</span>}
      </div>
    </form>
  );
}
