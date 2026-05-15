import { spawn } from "node:child_process";

export interface ProviderDetection {
  provider: string;
  reason: "flag" | "config" | "claude-cli" | "anthropic-env" | "openai-env" | "local-fallback";
}

let claudeCachedAvailability: boolean | null = null;

async function isClaudeCliAvailable(): Promise<boolean> {
  if (claudeCachedAvailability !== null) return claudeCachedAvailability;
  claudeCachedAvailability = await new Promise<boolean>((resolve) => {
    try {
      const proc = spawn("claude", ["--version"], { stdio: "ignore" });
      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
  return claudeCachedAvailability;
}

/**
 * Detect which AI provider the CLI should use.
 * Priority: explicit --provider flag > project config > env detection > local fallback.
 */
export async function detectProvider(
  flagProvider: string | undefined,
  configProvider: string | undefined,
): Promise<ProviderDetection> {
  if (flagProvider) return { provider: flagProvider, reason: "flag" };
  if (configProvider) return { provider: configProvider, reason: "config" };
  if (await isClaudeCliAvailable()) return { provider: "claude_code", reason: "claude-cli" };
  if (process.env.ANTHROPIC_API_KEY) return { provider: "claude_api", reason: "anthropic-env" };
  if (process.env.OPENAI_API_KEY) return { provider: "openai", reason: "openai-env" };
  return { provider: "local", reason: "local-fallback" };
}

/** Test-only: clear the cached `claude --version` result. */
export function _resetClaudeCacheForTests(): void {
  claudeCachedAvailability = null;
}
