import type { ProviderInfo } from "../../api/aiApi.js";

interface Props {
  providers: ProviderInfo[];
  value: string;
  onChange: (id: string) => void;
}

const HINTS: Record<string, (p: ProviderInfo) => { text: string; tone: "ok" | "warn" | "info" }> = {
  claude_code: (p) =>
    p.configured
      ? { text: `✓ ${p.hint ?? "ready"}`, tone: "ok" }
      : { text: p.hint ?? "install the `claude` CLI to enable", tone: "warn" },
  claude_api: (p) =>
    p.configured
      ? { text: "✓ ANTHROPIC_API_KEY set", tone: "ok" }
      : { text: "set ANTHROPIC_API_KEY in env", tone: "warn" },
  openai: (p) =>
    p.configured
      ? { text: "✓ OPENAI_API_KEY set", tone: "ok" }
      : { text: "set OPENAI_API_KEY in env", tone: "warn" },
  openai_compat: () => ({ text: "needs baseUrl + API key below", tone: "info" }),
  ollama: (p) =>
    p.configured
      ? { text: "must be running on localhost:11434", tone: "info" }
      : { text: "not detected", tone: "warn" },
};

const TONE_CLASS = {
  ok: "text-green-700 dark:text-green-400",
  warn: "text-amber-700 dark:text-amber-300",
  info: "text-stone-500 dark:text-stone-400",
};

export function ProviderRadio({ providers, value, onChange }: Props) {
  // Filter out 'local' — it's the implicit fallback, not a user-facing choice
  const userFacing = providers.filter((p) => p.id !== "local");

  return (
    <fieldset className="space-y-2">
      {userFacing.map((p) => {
        const hint = HINTS[p.id]?.(p) ?? { text: "", tone: "info" as const };
        const selectable = p.configured || p.id === "openai_compat";
        return (
          <label
            key={p.id}
            className={`flex items-center gap-3 px-3 py-2 border rounded cursor-pointer transition-colors ${
              value === p.id
                ? "border-stone-900 dark:border-stone-100 bg-stone-50 dark:bg-stone-800"
                : "border-stone-200 dark:border-stone-800 hover:border-stone-400 dark:hover:border-stone-600"
            } ${!selectable ? "opacity-50" : ""}`}
          >
            <input
              type="radio"
              name="provider"
              value={p.id}
              checked={value === p.id}
              onChange={() => onChange(p.id)}
              disabled={!selectable}
            />
            <span className="font-medium flex-1 text-stone-900 dark:text-stone-100">{p.name}</span>
            <span className={`text-xs ${TONE_CLASS[hint.tone]}`}>{hint.text}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
