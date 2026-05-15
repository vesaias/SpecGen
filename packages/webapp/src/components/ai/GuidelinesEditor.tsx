const MAX = 4000;

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export function GuidelinesEditor({ value, onChange }: Props) {
  const remaining = MAX - value.length;
  const overLimit = remaining < 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label
          htmlFor="guidelines"
          className="block text-sm font-medium text-stone-700 dark:text-stone-300"
        >
          Guidelines (markdown)
        </label>
        <span
          className={`text-xs ${
            overLimit ? "text-red-600 dark:text-red-400" : "text-stone-500 dark:text-stone-400"
          }`}
        >
          {value.length} / {MAX}
        </span>
      </div>
      <textarea
        id="guidelines"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        placeholder={
          "# Project guidelines\n- Use simple language\n- Mention the database table by name"
        }
        className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded font-mono text-sm"
      />
      <div className="text-xs text-stone-500 dark:text-stone-400 mt-1">
        Added <em>on top of</em> the selected profile — appended to every AI call as a "Project
        guidelines" section. Profile defines the output structure (schema, prompts); guidelines tune
        voice and conventions for this project (terminology, naming, "always mention X").
      </div>
    </div>
  );
}
