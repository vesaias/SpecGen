import { Link } from "react-router-dom";

interface Props {
  slug: string;
  className?: string;
}

/**
 * Amber pill rendered next to a project name when its AI config is
 * missing or pinned to the local stub. Clicking the "Set up" link
 * takes the user straight to the AI settings tab where they can fix
 * it.
 *
 * Two consumers today: the Dashboard project cards and the ProjectShell
 * topbar. Wording must stay identical between them — users see one
 * directly after the other.
 */
export function AiMissingBadge({ slug, className }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 ${
        className ?? ""
      }`}
      title="This project has no AI provider configured. Update and Rebuild will refuse to run."
    >
      AI not configured
      <Link
        to={`/projects/${slug}/settings/ai`}
        className="underline hover:text-amber-900 dark:hover:text-amber-100"
        onClick={(e) => e.stopPropagation()}
      >
        Set up
      </Link>
    </span>
  );
}
