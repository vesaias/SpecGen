import { useEffect, useState } from "react";
import { profilesApi } from "../../api/profilesApi.js";
import { Button } from "../ui/Button.js";

interface Props {
  slug: string;
  profileId: string;
  relPath: string;
}

export function ProfileFileEditor({ slug, profileId, relPath }: Props) {
  const [content, setContent] = useState<string>("");
  const [original, setOriginal] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSavedAt(null);
    profilesApi
      .getFile(profileId, relPath)
      .then((text) => {
        setContent(text);
        setOriginal(text);
        setLoading(false);
      })
      .catch((err) => {
        setError((err as Error).message);
        setLoading(false);
      });
  }, [profileId, relPath]);

  const dirty = content !== original;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await profilesApi.patchFile(slug, profileId, relPath, content);
      setOriginal(content);
      setSavedAt(Date.now());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-stone-500 dark:text-stone-400 text-sm">Loading…</div>;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <code className="font-mono text-sm text-stone-900 dark:text-stone-100">{relPath}</code>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">unsaved</span>}
          {savedAt !== null && !dirty && (
            <span className="text-xs text-stone-500 dark:text-stone-400">Saved.</span>
          )}
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save override"}
          </Button>
        </div>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={28}
        className="w-full px-3 py-2 border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded font-mono text-xs"
        spellCheck={false}
      />
      {error && <div className="text-sm text-red-600 dark:text-red-400">{error}</div>}
      <div className="text-xs text-stone-500 dark:text-stone-400">
        Saving creates a project-level override at{" "}
        <code className="font-mono">
          .specgen/profiles/{profileId}/{relPath}
        </code>
        . The base file in the packaged profile is unchanged.
      </div>
    </div>
  );
}
