import { spawn } from "node:child_process";
import type {
  AiClient,
  AiClientModel,
  AiCompletionInput,
  AiCompletionResult,
} from "../AiClient.js";

export interface ClaudeCodeClientOptions {
  /** Override the binary name (defaults to "claude"). Useful for tests / non-PATH installs. */
  binary?: string;
}

/**
 * Provider that spawns the `claude` CLI as a subprocess so users on a
 * Claude Pro/Max subscription get $0/call. Mirrors JobNavigator's
 * `_call_claude_code()` pattern.
 *
 * **Critical:** strips ANTHROPIC_API_KEY from env before spawn so the CLI
 * uses subscription billing (CLAUDE_CODE_OAUTH_TOKEN), not API credits.
 */
export class ClaudeCodeClient implements AiClient {
  readonly provider = "claude_code";
  readonly models: ReadonlyArray<AiClientModel> = [
    { id: "claude-opus-4-7", displayName: "Claude Opus 4.7" },
    { id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5", displayName: "Claude Haiku 4.5" },
  ];
  private readonly binary: string;

  constructor(opts: ClaudeCodeClientOptions = {}) {
    this.binary = opts.binary ?? "claude";
  }

  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    const fullPrompt = input.system ? `${input.system}\n\n${input.prompt}` : input.prompt;
    const args = ["-p", "--output-format", "json"];
    if (input.model) args.push("--model", input.model);

    // Strip ANTHROPIC_API_KEY so the CLI uses subscription billing
    // (CLAUDE_CODE_OAUTH_TOKEN), not API credits.
    // `delete` is critical — assigning `undefined` sets the env var to the
    // literal string "undefined" on some Node versions.
    const env = { ...process.env };
    // biome-ignore lint/performance/noDelete: assigning undefined sets the env var to the literal string "undefined" on some Node versions; delete is intentional
    delete env.ANTHROPIC_API_KEY;
    // biome-ignore lint/performance/noDelete: assigning undefined sets the env var to the literal string "undefined" on some Node versions; delete is intentional
    delete env.ANTHROPIC_AUTH_TOKEN;

    return new Promise<AiCompletionResult>((resolve, reject) => {
      const proc = spawn(this.binary, args, { env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";

      // Honour caller-supplied AbortSignal so user-initiated Cancel kills
      // the in-flight CLI invocation rather than waiting for it to finish.
      const onAbort = () => {
        proc.kill("SIGTERM");
        reject(new Error("claude_code: aborted"));
      };
      if (input.signal) {
        if (input.signal.aborted) {
          onAbort();
          return;
        }
        input.signal.addEventListener("abort", onAbort, { once: true });
      }

      proc.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      proc.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      proc.on("close", () => {
        if (input.signal) input.signal.removeEventListener("abort", onAbort);
      });
      proc.on("error", (err) => {
        reject(new Error(`claude_code: failed to spawn '${this.binary}': ${err.message}`));
      });
      proc.on("close", (code) => {
        // The CLI emits JSON to stdout on both success AND failure paths
        // (e.g. {"is_error":true,"result":"Not logged in · Please run /login"}).
        // Parse first; surface the actual error text instead of "subprocess exited 1".
        let text = stdout.trim();
        let parsed: { is_error?: boolean; result?: string } | null = null;
        try {
          parsed = JSON.parse(text) as { is_error?: boolean; result?: string };
        } catch {
          // Not JSON — leave parsed null; we'll fall back to raw stderr/stdout
        }

        if (parsed?.is_error === true) {
          const msg =
            typeof parsed.result === "string" && parsed.result.trim().length > 0
              ? parsed.result.trim()
              : "claude CLI returned is_error: true with no message";
          reject(new Error(`claude_code: ${msg}`));
          return;
        }

        if (code !== 0) {
          const detail = stderr.trim() || text || "(no output)";
          reject(new Error(`claude_code: subprocess exited ${code}: ${detail}`));
          return;
        }

        if (parsed && typeof parsed.result === "string") text = parsed.result;
        resolve({
          text: text.trim(),
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
          },
        });
      });

      proc.stdin?.write(fullPrompt);
      proc.stdin?.end();
    });
  }
}
