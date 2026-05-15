import { spawn } from "node:child_process";

export interface ClaudeCodeAvailability {
  onPath: boolean;
  tokenSet: boolean;
  /** True only when BOTH the binary is on PATH AND a non-empty token is set. */
  ready: boolean;
}

let cachedOnPath: boolean | null = null;

/**
 * Probe whether the `claude` CLI is usable for the `claude_code` provider.
 *
 * - `onPath`: cached per process — the binary doesn't appear/disappear during
 *   a single server run.
 * - `tokenSet`: read fresh each call — operators can edit .env + restart the
 *   container (or `docker compose restart specgen`) and the new env reaches a
 *   fresh server process.
 * - `ready`: AND of both. Use this for "should we offer `claude_code` in the UI?"
 *
 * Tests can call `resetClaudeCodeDetectorCache()` between runs.
 */
export async function probeClaudeCode(): Promise<ClaudeCodeAvailability> {
  if (cachedOnPath === null) {
    cachedOnPath = await new Promise<boolean>((resolve) => {
      try {
        const proc = spawn("claude", ["--version"], { stdio: "ignore" });
        proc.on("error", () => resolve(false));
        proc.on("close", (code) => resolve(code === 0));
      } catch {
        resolve(false);
      }
    });
  }
  const tokenSet = (process.env.CLAUDE_CODE_OAUTH_TOKEN ?? "").trim().length > 0;
  return {
    onPath: cachedOnPath,
    tokenSet,
    ready: cachedOnPath && tokenSet,
  };
}

/**
 * Legacy boolean check — kept for callers that just want "is claude_code usable?".
 * Returns the `ready` field from probeClaudeCode().
 */
export async function isClaudeCodeAvailable(): Promise<boolean> {
  return (await probeClaudeCode()).ready;
}

export function resetClaudeCodeDetectorCache(): void {
  cachedOnPath = null;
}
