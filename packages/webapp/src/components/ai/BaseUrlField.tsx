interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  helper?: string;
}

export function BaseUrlField({ value, onChange, placeholder, helper }: Props) {
  return (
    <div>
      <label
        htmlFor="baseUrl"
        className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
      >
        Base URL
      </label>
      <input
        id="baseUrl"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "https://api.example.com/v1"}
        className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded font-mono text-sm"
      />
      {helper && <div className="text-xs text-stone-500 dark:text-stone-400 mt-1">{helper}</div>}
    </div>
  );
}
