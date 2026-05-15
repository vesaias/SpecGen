import { existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Validate that a user-supplied filesystem path is safe to use as a project root.
 *
 * Rules:
 *   - Must be a non-empty string
 *   - Must not contain a `..` segment (defence-in-depth — `path.resolve` would
 *     normalise them away, but we want traversal attempts to fail loudly)
 *   - Must resolve to an absolute path that exists and is a directory
 *
 * Returns the absolute resolved path. Throws an `Error & { status: 400 }` on
 * failure so Express error middleware can surface a clean 400 response.
 */
export function validateLocalPath(p: unknown): string {
  if (typeof p !== "string" || p.length === 0) {
    const e = new Error("source.localPath is required for local projects") as Error & {
      status: number;
    };
    e.status = 400;
    throw e;
  }
  if (p.split(/[/\\]/).some((seg) => seg === "..")) {
    const e = new Error("source.localPath must not contain '..'") as Error & { status: number };
    e.status = 400;
    throw e;
  }
  const abs = path.resolve(p);
  if (!path.isAbsolute(abs)) {
    const e = new Error("source.localPath must resolve to an absolute path") as Error & {
      status: number;
    };
    e.status = 400;
    throw e;
  }
  if (!existsSync(abs)) {
    const e = new Error(`source.localPath does not exist: ${abs}`) as Error & { status: number };
    e.status = 400;
    throw e;
  }
  if (!statSync(abs).isDirectory()) {
    const e = new Error(`source.localPath is not a directory: ${abs}`) as Error & {
      status: number;
    };
    e.status = 400;
    throw e;
  }
  return abs;
}
