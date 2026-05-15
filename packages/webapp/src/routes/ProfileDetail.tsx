import type { Project } from "@specgen/server";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { projectsApi } from "../api/client.js";
import { type ProfileDetail as ProfileDetailData, profilesApi } from "../api/profilesApi.js";
import { TestProfileButton } from "../components/ai/TestProfileButton.js";
import { ForkIntoProjectModal } from "../components/profile/ForkIntoProjectModal.js";
import { ForkProfileButton } from "../components/profile/ForkProfileButton.js";
import { ProfileFileEditor } from "../components/profile/ProfileFileEditor.js";
import { ProfilePreview } from "../components/profile/ProfilePreview.js";
import { AppShell } from "../components/ui/AppShell.js";
import { Button } from "../components/ui/Button.js";

/**
 * Profile detail. Two modes:
 *
 *  - Project-scoped (`/projects/:slug/profiles/:profileId`): URL has both
 *    `slug` and `profileId`. Loads the project to determine the active
 *    profile and to scope fork/file-override operations. Shows the file
 *    editor, "Set as active", "Fork", and "Test profile" controls.
 *
 *  - Global (`/profiles/:profileId`): No `slug`. Read-only. Lists the
 *    profile's files but renders them in a non-editable preview because
 *    saving an override requires a target project. The header has a
 *    "Fork into…" button that opens a project picker; after picking,
 *    the user is navigated to the project-scoped detail page where
 *    edits go to the project's fork.
 */
export function ProfileDetail() {
  const { slug, profileId } = useParams<{ slug?: string; profileId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [profile, setProfile] = useState<ProfileDetailData | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forkModalOpen, setForkModalOpen] = useState(false);

  const isGlobal = !slug;

  const loadProfile = useCallback(async () => {
    if (!profileId) return;
    try {
      const detail = await profilesApi.get(profileId);
      setProfile(detail);
      setSelectedFile((cur) => cur ?? (detail.files.length > 0 ? detail.files[0] : null));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [profileId]);

  useEffect(() => {
    if (!slug) {
      setProject(null);
      return;
    }
    projectsApi
      .get(slug)
      .then(setProject)
      .catch((err) => setError((err as Error).message));
  }, [slug]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // In global (read-only) mode, fetch file contents directly since the
  // editor component requires a slug.
  useEffect(() => {
    if (!isGlobal || !profileId || !selectedFile) {
      setFileContent(null);
      return;
    }
    setFileLoading(true);
    profilesApi
      .getFile(profileId, selectedFile)
      .then((text) => {
        setFileContent(text);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setFileLoading(false));
  }, [isGlobal, profileId, selectedFile]);

  async function handleSetActive() {
    if (!slug || !profileId) return;
    await projectsApi.update(slug, {
      ai: { ...((project?.ai as Record<string, unknown> | undefined) ?? {}), profileId },
    });
    const refreshed = await projectsApi.get(slug);
    setProject(refreshed);
  }

  if (error)
    return (
      <AppShell maxWidth="screen-2xl">
        <div className="text-red-600 dark:text-red-400">Error: {error}</div>
      </AppShell>
    );
  if ((!isGlobal && !project) || !profile)
    return (
      <AppShell maxWidth="screen-2xl">
        <div className="text-stone-500 dark:text-stone-400">Loading…</div>
      </AppShell>
    );

  const activeId = (project?.ai as { profileId?: string } | undefined)?.profileId ?? "pm-spec";
  const isActive = !isGlobal && profileId === activeId;

  const breadcrumb = isGlobal ? (
    <Link
      to="/profiles"
      className="text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
    >
      ← Profiles
    </Link>
  ) : (
    <Link
      to={`/projects/${slug}/profiles`}
      className="text-stone-500 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100"
    >
      ← Profiles
    </Link>
  );

  return (
    <AppShell maxWidth="screen-2xl" left={breadcrumb}>
      <header className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            {profile.manifest.name}
          </h1>
          <div className="text-sm text-stone-500 dark:text-stone-400">
            <code className="font-mono">{profile.manifest.id}</code> v{profile.manifest.version}
            {profile.manifest.extends && (
              <>
                {" "}
                · extends <code className="font-mono">{profile.manifest.extends}</code>
              </>
            )}
            {"  "}
            chain: {profile.inheritanceChain.join(" → ")}
            {isGlobal && (
              <>
                {" · "}
                <span className="text-stone-400 dark:text-stone-600">read-only (global view)</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isGlobal ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setForkModalOpen(true)}
              disabled={!profileId}
            >
              Fork into…
            </Button>
          ) : (
            <>
              {isActive ? (
                <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 rounded">
                  Active
                </span>
              ) : (
                <Button size="sm" variant="secondary" onClick={handleSetActive}>
                  Set as active
                </Button>
              )}
              {slug && profileId && (
                <ForkProfileButton
                  slug={slug}
                  profileId={profileId}
                  onForked={() => {
                    loadProfile();
                    navigate(`/projects/${slug}/profiles/${profileId}`);
                  }}
                />
              )}
              {slug && <TestProfileButton slug={slug} />}
            </>
          )}
        </div>
      </header>

      <div className="grid grid-cols-[200px_1fr_300px] gap-4">
        <nav className="space-y-0.5">
          {profile.files.map((f) => (
            <button
              type="button"
              key={f}
              onClick={() => setSelectedFile(f)}
              className={`w-full text-left px-2 py-1 text-xs font-mono rounded transition-colors ${
                selectedFile === f
                  ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900"
                  : "text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-800"
              }`}
            >
              {f}
            </button>
          ))}
        </nav>

        <main className="min-w-0">
          {selectedFile && profileId && !isGlobal && slug && (
            <ProfileFileEditor slug={slug} profileId={profileId} relPath={selectedFile} />
          )}
          {selectedFile && profileId && isGlobal && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <code className="font-mono text-sm text-stone-900 dark:text-stone-100">
                  {selectedFile}
                </code>
                <span className="text-xs text-stone-500 dark:text-stone-400">read-only</span>
              </div>
              {fileLoading ? (
                <div className="text-sm text-stone-500 dark:text-stone-400">Loading…</div>
              ) : (
                <pre className="w-full px-3 py-2 border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 text-stone-900 dark:text-stone-100 rounded font-mono text-xs whitespace-pre-wrap break-words max-h-[700px] overflow-auto">
                  {fileContent ?? ""}
                </pre>
              )}
              <div className="text-xs text-stone-500 dark:text-stone-400">
                To edit, fork this profile into a project. Saves create a project-level override at{" "}
                <code className="font-mono">.specgen/profiles/{profileId}/…</code>.
              </div>
            </div>
          )}
        </main>

        <aside>{profileId && <ProfilePreview profileId={profileId} />}</aside>
      </div>

      {profileId && (
        <ForkIntoProjectModal
          profileId={profileId}
          open={forkModalOpen}
          onClose={() => setForkModalOpen(false)}
        />
      )}
    </AppShell>
  );
}
