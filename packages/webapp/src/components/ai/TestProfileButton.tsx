import { useEffect, useState } from "react";
import { type AiTestResult, aiApi } from "../../api/aiApi.js";
import { specApi } from "../../api/client.js";
import { Button } from "../ui/Button.js";
import { Modal } from "../ui/Modal.js";

interface Props {
  slug: string;
  /** Optional label override — default "Test profile". */
  label?: string;
  /** Optional className for the trigger button. */
  className?: string;
}

interface SpecItemSummary {
  id: string;
  type: string;
  title: string;
}

export function TestProfileButton({ slug, label = "Test profile", className }: Props) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SpecItemSummary[]>([]);
  const [itemId, setItemId] = useState<string>("");
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiTestResult | null>(null);
  const [itemsError, setItemsError] = useState<string | null>(null);

  // Load items lazily on first open
  useEffect(() => {
    if (!open || items.length > 0 || itemsError) return;
    specApi
      .get(slug)
      .then((spec) => {
        const list = Object.values(spec.items ?? {}).map((it) => ({
          id: it.id,
          type: it.type,
          title: it.title,
        }));
        setItems(list);
      })
      .catch((err) => setItemsError((err as Error).message));
  }, [open, slug, items.length, itemsError]);

  async function handleRun() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const body = customPrompt.trim()
        ? { prompt: customPrompt.trim() }
        : itemId
          ? { itemId }
          : null;
      if (!body) {
        setError("Pick an item or enter a prompt");
        setRunning(false);
        return;
      }
      const r = await aiApi.test(slug, body);
      setResult(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function handleClose() {
    setOpen(false);
    // Keep result + form values so reopening keeps state — clear with explicit "Reset"
  }

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)} className={className}>
        {label}
      </Button>

      <Modal open={open} onClose={handleClose} title="Test profile" size="xl">
        <div className="grid grid-cols-2 gap-5">
          <div className="space-y-3">
            <div>
              <label
                htmlFor="item"
                className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
              >
                Item (from project spec)
              </label>
              <select
                id="item"
                value={itemId}
                onChange={(e) => {
                  setItemId(e.target.value);
                  if (e.target.value) setCustomPrompt("");
                }}
                disabled={Boolean(customPrompt.trim())}
                className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded text-sm"
              >
                <option value="">— pick an item —</option>
                {items.map((it) => (
                  <option key={it.id} value={it.id}>
                    [{it.type}] {it.title}
                  </option>
                ))}
              </select>
              {itemsError && (
                <div className="text-xs text-red-600 dark:text-red-400 mt-1">{itemsError}</div>
              )}
            </div>

            <div className="text-center text-xs text-stone-400 dark:text-stone-600">— or —</div>

            <div>
              <label
                htmlFor="customprompt"
                className="block text-sm font-medium mb-1 text-stone-700 dark:text-stone-300"
              >
                Free-form prompt
              </label>
              <textarea
                id="customprompt"
                value={customPrompt}
                onChange={(e) => {
                  setCustomPrompt(e.target.value);
                  if (e.target.value.trim()) setItemId("");
                }}
                rows={5}
                placeholder="Describe what to test, in plain English."
                className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 rounded text-sm font-mono"
              />
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={handleRun} disabled={running || (!itemId && !customPrompt.trim())}>
                {running ? "Running…" : "Run"}
              </Button>
              {result && (
                <Button variant="ghost" size="sm" onClick={() => setResult(null)}>
                  Clear
                </Button>
              )}
            </div>

            {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
          </div>

          <div className="border-l border-stone-200 dark:border-stone-800 pl-5">
            {result ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Stat label="Provider" value={result.provider} />
                  <Stat label="Model" value={result.model} />
                  <Stat label="Duration" value={`${result.durationMs} ms`} />
                  <Stat
                    label="Cost"
                    value={
                      result.costUsd === 0 ? "free / subscription" : `$${result.costUsd.toFixed(4)}`
                    }
                  />
                  <Stat label="Input tokens" value={String(result.usage.input_tokens)} />
                  <Stat label="Output tokens" value={String(result.usage.output_tokens)} />
                  {(result.usage.cache_read_tokens > 0 || result.usage.cache_write_tokens > 0) && (
                    <>
                      <Stat label="Cache read" value={String(result.usage.cache_read_tokens)} />
                      <Stat label="Cache write" value={String(result.usage.cache_write_tokens)} />
                    </>
                  )}
                </div>

                <details className="border border-stone-200 dark:border-stone-800 rounded">
                  <summary className="px-3 py-1.5 cursor-pointer text-xs font-medium text-stone-700 dark:text-stone-300 select-none">
                    Rendered prompt
                  </summary>
                  <pre className="p-3 text-xs font-mono bg-stone-50 dark:bg-stone-800 text-stone-800 dark:text-stone-200 overflow-x-auto whitespace-pre-wrap break-words max-h-[200px]">
                    {result.promptText}
                  </pre>
                </details>

                <div>
                  <div className="text-xs font-medium mb-1 text-stone-700 dark:text-stone-300">
                    Output
                  </div>
                  <pre className="p-3 text-xs font-mono bg-stone-50 dark:bg-stone-800 text-stone-800 dark:text-stone-200 border border-stone-200 dark:border-stone-800 rounded overflow-x-auto whitespace-pre-wrap break-words max-h-[400px]">
                    {result.output}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="text-sm text-stone-500 dark:text-stone-400">
                Pick an item or enter a custom prompt, then click Run. Result appears here.
              </div>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-stone-500 dark:text-stone-500 uppercase text-[10px] tracking-wide">
        {label}
      </div>
      <div className="font-mono text-xs text-stone-900 dark:text-stone-100">{value}</div>
    </div>
  );
}
