import { useState } from "react";
import type { ResponseData } from "../../types";

interface Props {
  responses: ResponseData[];
  editable: boolean;
  onChange: (responses: ResponseData[]) => void;
}

function statusClass(status: number): string {
  if (status < 300)
    return "text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800";
  if (status < 500)
    return "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800";
  return "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800";
}

export default function ResponseBlock({ responses, editable, onChange }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);

  if (responses.length === 0) {
    if (!editable) return null;
    return (
      <button
        type="button"
        onClick={() => onChange([{ status: 200, description: "Success", body: "" }])}
        className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-600 dark:hover:text-stone-300 px-3 py-2 border border-dashed border-stone-300 dark:border-stone-700 rounded-lg hover:border-stone-400 dark:hover:border-stone-500 transition-colors w-full"
      >
        + Add response
      </button>
    );
  }

  const active = responses[activeIdx] || responses[0];

  function updateActive(updates: Partial<ResponseData>) {
    const newResponses = responses.map((r, i) => (i === activeIdx ? { ...r, ...updates } : r));
    onChange(newResponses);
  }

  function addResponse() {
    const usedStatuses = new Set(responses.map((r) => r.status));
    const next = [200, 400, 404, 500, 201, 403, 422].find((s) => !usedStatuses.has(s)) || 200;
    onChange([...responses, { status: next, description: "", body: "" }]);
    setActiveIdx(responses.length);
  }

  function removeResponse(idx: number) {
    const newResponses = responses.filter((_, i) => i !== idx);
    onChange(newResponses);
    if (activeIdx >= newResponses.length) setActiveIdx(Math.max(0, newResponses.length - 1));
  }

  return (
    <div>
      <div className="flex gap-1 border-b-2 border-stone-200 dark:border-stone-700 items-end">
        {responses.map((r, i) => (
          <div key={i} className="relative group/tab">
            <button
              type="button"
              onClick={() => setActiveIdx(i)}
              className={`px-4 py-2 text-sm font-semibold rounded-t border border-b-0 relative top-[2px] transition-all
                ${
                  i === activeIdx
                    ? statusClass(r.status)
                    : "text-stone-400 dark:text-stone-500 border-transparent hover:bg-stone-50 dark:hover:bg-stone-800"
                }`}
            >
              {editable ? (
                <input
                  value={r.status}
                  onChange={(e) => {
                    const val = Number.parseInt(e.target.value) || 0;
                    const newResponses = responses.map((resp, ri) =>
                      ri === i ? { ...resp, status: val } : resp,
                    );
                    onChange(newResponses);
                  }}
                  className="bg-transparent outline-none w-12 text-center font-semibold"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                r.status
              )}
            </button>
            {editable && (
              <button
                type="button"
                onClick={() => removeResponse(i)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-red-400 text-white rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover/tab:opacity-100 transition-opacity"
              >
                ×
              </button>
            )}
          </div>
        ))}
        {editable && (
          <button
            type="button"
            onClick={addResponse}
            className="px-3 py-2 text-stone-300 dark:text-stone-600 hover:text-stone-500 dark:hover:text-stone-300 text-sm"
            title="Add status code"
          >
            +
          </button>
        )}
      </div>
      <div className="py-4">
        {editable ? (
          <>
            <input
              value={active.description}
              onChange={(e) => updateActive({ description: e.target.value })}
              placeholder="Response description..."
              className="w-full text-sm text-stone-600 dark:text-stone-300 bg-transparent placeholder:text-stone-400 dark:placeholder:text-stone-600 mb-3 outline-none border-b border-transparent focus:border-stone-300 dark:focus:border-stone-700 pb-1"
            />
            <textarea
              value={active.body}
              onChange={(e) => updateActive({ body: e.target.value })}
              placeholder="Response body JSON..."
              className="w-full bg-gray-900 text-green-400 font-mono text-sm p-4 rounded-lg border border-gray-700 min-h-[80px] resize-y outline-none focus:border-[#6b705c]"
              spellCheck={false}
            />
          </>
        ) : (
          <>
            {active.description && (
              <div className="text-sm text-stone-500 dark:text-stone-400 mb-2">
                {active.description}
              </div>
            )}
            {active.body && (
              <pre className="bg-[#1e1e2e] text-[#cdd6f4] border border-gray-800 rounded-lg p-4 overflow-x-auto text-sm font-mono leading-relaxed">
                <code>{active.body}</code>
              </pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
