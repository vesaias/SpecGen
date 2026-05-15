import { useEffect, useState } from "react";
import { profilesApi } from "../../api/profilesApi.js";

interface Props {
  profileId: string;
}

export function ProfilePreview({ profileId }: Props) {
  const [content, setContent] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setContent(null);
    setMissing(false);
    profilesApi
      .getFile(profileId, "examples/sample-output.json")
      .then(setContent)
      .catch(() => setMissing(true));
  }, [profileId]);

  return (
    <div className="border border-stone-200 dark:border-stone-800 rounded p-3 sticky top-20">
      <div className="text-xs uppercase tracking-wide text-stone-500 dark:text-stone-500 mb-2">
        Preview
      </div>
      {missing ? (
        <div className="text-xs text-stone-500 dark:text-stone-400">
          No <code className="font-mono">examples/sample-output.json</code> in this profile.
        </div>
      ) : content === null ? (
        <div className="text-xs text-stone-500 dark:text-stone-400">Loading preview…</div>
      ) : (
        <pre className="text-xs font-mono bg-stone-50 dark:bg-stone-800 text-stone-800 dark:text-stone-200 p-2 rounded overflow-x-auto whitespace-pre-wrap break-words max-h-[600px]">
          {content}
        </pre>
      )}
    </div>
  );
}
