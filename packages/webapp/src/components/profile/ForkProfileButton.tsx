import { useState } from "react";
import { profilesApi } from "../../api/profilesApi.js";
import { Button } from "../ui/Button.js";

interface Props {
  slug: string;
  profileId: string;
  onForked?: () => void;
}

export function ForkProfileButton({ slug, profileId, onForked }: Props) {
  const [forking, setForking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleFork() {
    setForking(true);
    setError(null);
    try {
      await profilesApi.fork(slug, profileId);
      setDone(true);
      onForked?.();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("409")) {
        setError("Already forked");
      } else {
        setError(msg);
      }
    } finally {
      setForking(false);
    }
  }

  if (done && !error) {
    return (
      <Button
        size="sm"
        variant="secondary"
        disabled
        className="border-green-300 dark:border-green-800 bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300"
      >
        ✓ Forked
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="secondary" onClick={handleFork} disabled={forking}>
        {forking ? "Forking…" : "Fork"}
      </Button>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
