import type { ProviderModel } from "../../api/aiApi.js";

interface Props {
  models: ProviderModel[];
  value: string;
  onChange: (id: string) => void;
  subscriptionBased?: boolean;
}

function formatCost(m: ProviderModel, subscription: boolean): string {
  if (subscription) return "subscription";
  if (m.costPer1MIn === undefined || m.costPer1MOut === undefined) return "";
  return `$${m.costPer1MIn}/$${m.costPer1MOut} per 1M tok`;
}

export function ModelPicker({ models, value, onChange, subscriptionBased }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded font-mono text-sm"
    >
      <option value="">— pick a model —</option>
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.displayName} ({formatCost(m, subscriptionBased ?? false)})
        </option>
      ))}
    </select>
  );
}
