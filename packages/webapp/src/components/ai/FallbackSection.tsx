import { useState } from "react";
import type { ProviderInfo } from "../../api/aiApi.js";
import { BaseUrlField } from "./BaseUrlField.js";
import { ModelPicker } from "./ModelPicker.js";
import { ProviderRadio } from "./ProviderRadio.js";

interface Props {
  providers: ProviderInfo[];
  fallbackProvider: string;
  fallbackModel: string;
  fallbackBaseUrl: string;
  onChange: (patch: {
    fallbackProvider?: string;
    fallbackModel?: string;
    fallbackBaseUrl?: string;
  }) => void;
}

export function FallbackSection({
  providers,
  fallbackProvider,
  fallbackModel,
  fallbackBaseUrl,
  onChange,
}: Props) {
  const [open, setOpen] = useState<boolean>(Boolean(fallbackProvider));
  const provider = providers.find((p) => p.id === fallbackProvider);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="border border-stone-200 dark:border-stone-800 rounded"
    >
      <summary className="px-3 py-2 cursor-pointer text-sm font-medium text-stone-900 dark:text-stone-100 select-none">
        {fallbackProvider
          ? `Fallback: ${provider?.name ?? fallbackProvider}`
          : "Add fallback provider (optional)"}
      </summary>
      <div className="px-3 pb-3 space-y-3">
        <div className="text-xs text-stone-500 dark:text-stone-400">
          Used when the primary provider fails after 4 retries. Same provider list — pick a
          different one for resilience.
        </div>
        <ProviderRadio
          providers={providers}
          value={fallbackProvider}
          onChange={(id) => onChange({ fallbackProvider: id, fallbackModel: "" })}
        />
        {fallbackProvider && (
          <>
            <ModelPicker
              models={provider?.models ?? []}
              value={fallbackModel}
              onChange={(id) => onChange({ fallbackModel: id })}
              subscriptionBased={provider?.subscriptionBased}
            />
            {(fallbackProvider === "openai_compat" || provider?.requiresBaseUrl) && (
              <BaseUrlField
                value={fallbackBaseUrl}
                onChange={(v) => onChange({ fallbackBaseUrl: v })}
                placeholder="https://api.together.ai/v1"
              />
            )}
          </>
        )}
        {fallbackProvider && (
          <button
            type="button"
            onClick={() =>
              onChange({ fallbackProvider: "", fallbackModel: "", fallbackBaseUrl: "" })
            }
            className="text-xs text-red-600 dark:text-red-400 hover:underline"
          >
            Remove fallback
          </button>
        )}
      </div>
    </details>
  );
}
