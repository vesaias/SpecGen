import { unwrapPlainText, wrapPlainText } from "../utils/tiptapHelpers";
import TiptapEditor from "./TiptapEditor";

interface OrchStep {
  step: number;
  call: string;
  description: string;
}

interface Props {
  steps: OrchStep[];
  editable: boolean;
  onUpdateStep: (stepIndex: number, description: string) => void;
}

export default function OrchestrationSteps({ steps, editable, onUpdateStep }: Props) {
  if (steps.length === 0) return null;

  return (
    <div className="space-y-4">
      {steps.map((s, i) => {
        const isTodo = s.description === "[TODO]";
        return (
          <div key={s.step} className="flex gap-3 pl-2">
            <div className="w-6 h-6 bg-brand-600 dark:bg-brand-500 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
              {s.step}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm text-stone-900 dark:text-stone-100">
                <code className="bg-stone-100 dark:bg-stone-800 px-1.5 py-0.5 rounded text-xs">
                  {s.call}
                </code>
              </div>
              {editable ? (
                <div className="mt-1">
                  <TiptapEditor
                    content={wrapPlainText(isTodo ? "" : s.description)}
                    onChange={(content) => onUpdateStep(i, unwrapPlainText(content))}
                    editable={true}
                    placeholder="Describe this step..."
                  />
                </div>
              ) : (
                <div className="text-sm text-stone-600 dark:text-stone-400 mt-1">
                  {isTodo ? (
                    <span className="italic text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border-l-2 border-amber-400 dark:border-amber-600 px-2 py-0.5 inline-block">
                      [TODO: describe this step]
                    </span>
                  ) : (
                    <TiptapEditor
                      content={wrapPlainText(s.description)}
                      onChange={() => {}}
                      editable={false}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
