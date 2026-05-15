import { httpError } from "../middleware/errorHandler.js";

const ALLOWED = [
  /^profile\.yaml$/,
  /^prompts\/[a-z0-9][a-z0-9_-]*\.md$/,
  /^output\/[a-z0-9][a-z0-9_-]*\.json$/,
  /^examples\/[a-z0-9][a-z0-9_-]*\.json$/,
  /^README\.md$/,
];

/**
 * Validates that a relative profile file path is safe and within the allow-list.
 * Throws an httpError(400) if invalid.
 *
 * Allow-listed paths:
 *  - profile.yaml
 *  - prompts/<a-z0-9-_>.md
 *  - output/<a-z0-9-_>.json
 *  - examples/<a-z0-9-_>.json
 *  - README.md
 */
export function validateProfileFilePath(relPath: string): void {
  if (typeof relPath !== "string" || relPath.length === 0) {
    throw httpError(400, "path query param required");
  }
  if (relPath.includes("..") || relPath.startsWith("/") || relPath.startsWith("\\")) {
    throw httpError(400, "Path traversal detected");
  }
  if (!ALLOWED.some((re) => re.test(relPath))) {
    throw httpError(400, `Invalid profile file path: ${relPath}`);
  }
}
