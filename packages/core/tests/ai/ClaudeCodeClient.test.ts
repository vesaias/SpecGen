import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted to the top of the file by Vitest, so the factory runs
// before top-level variable assignments. vi.hoisted() creates a value that
// is also hoisted, making it safe to reference inside the factory.
const { mockSpawn } = vi.hoisted(() => ({ mockSpawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mockSpawn }));

import { ClaudeCodeClient } from "../../src/ai/providers/ClaudeCodeClient.js";

interface FakeProc extends EventEmitter {
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: EventEmitter;
  stderr: EventEmitter;
}

function makeFakeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

beforeEach(() => {
  mockSpawn.mockReset();
});

describe("ClaudeCodeClient", () => {
  it("builds correct command + strips ANTHROPIC_API_KEY from env", async () => {
    const fake = makeFakeProc();
    mockSpawn.mockReturnValue(fake);

    const client = new ClaudeCodeClient();
    process.env.ANTHROPIC_API_KEY = "should-be-stripped";

    const promise = client.complete({
      prompt: "Describe X",
      model: "claude-sonnet-4-6",
      temperature: 0,
      maxTokens: 100,
    });

    // Verify the spawn args
    expect(mockSpawn).toHaveBeenCalledWith(
      "claude",
      ["-p", "--output-format", "json", "--model", "claude-sonnet-4-6"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
    const env = mockSpawn.mock.calls[0][2]?.env as Record<string, string>;
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();

    // Simulate JSON output
    fake.stdout.emit("data", Buffer.from('{"result": "Description of X"}'));
    fake.emit("close", 0);

    const r = await promise;
    expect(r.text).toBe("Description of X");
    expect(r.usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    });

    process.env.ANTHROPIC_API_KEY = undefined;
  });

  it("omits --model when model is empty string", async () => {
    const fake = makeFakeProc();
    mockSpawn.mockReturnValue(fake);

    const promise = new ClaudeCodeClient().complete({
      prompt: "x",
      model: "",
      temperature: 0,
      maxTokens: 100,
    });

    expect(mockSpawn.mock.calls[0][1]).toEqual(["-p", "--output-format", "json"]);
    fake.stdout.emit("data", Buffer.from('{"result":"ok"}'));
    fake.emit("close", 0);
    await promise;
  });

  it("falls back to raw stdout when output is not JSON", async () => {
    const fake = makeFakeProc();
    mockSpawn.mockReturnValue(fake);

    const promise = new ClaudeCodeClient().complete({
      prompt: "x",
      model: "m",
      temperature: 0,
      maxTokens: 100,
    });

    fake.stdout.emit("data", Buffer.from("plain text response"));
    fake.emit("close", 0);

    const r = await promise;
    expect(r.text).toBe("plain text response");
  });

  it("pipes system + prompt joined with two newlines to stdin", async () => {
    const fake = makeFakeProc();
    mockSpawn.mockReturnValue(fake);

    const promise = new ClaudeCodeClient().complete({
      prompt: "User prompt",
      system: "System context",
      model: "m",
      temperature: 0,
      maxTokens: 100,
    });

    expect(fake.stdin.write).toHaveBeenCalledWith("System context\n\nUser prompt");
    expect(fake.stdin.end).toHaveBeenCalled();

    fake.stdout.emit("data", Buffer.from('{"result":"ok"}'));
    fake.emit("close", 0);
    await promise;
  });

  it("throws on non-zero exit code with stderr details", async () => {
    const fake = makeFakeProc();
    mockSpawn.mockReturnValue(fake);

    const promise = new ClaudeCodeClient().complete({
      prompt: "x",
      model: "m",
      temperature: 0,
      maxTokens: 100,
    });

    fake.stderr.emit("data", Buffer.from("authentication failed"));
    fake.emit("close", 2);

    await expect(promise).rejects.toThrow(/claude_code.*exited 2.*authentication failed/i);
  });

  it("throws on spawn error (binary not found)", async () => {
    const fake = makeFakeProc();
    mockSpawn.mockReturnValue(fake);

    const promise = new ClaudeCodeClient().complete({
      prompt: "x",
      model: "m",
      temperature: 0,
      maxTokens: 100,
    });

    fake.emit("error", new Error("spawn ENOENT"));

    await expect(promise).rejects.toThrow(/claude_code.*spawn.*ENOENT/i);
  });

  it("respects custom binary option", async () => {
    const fake = makeFakeProc();
    mockSpawn.mockReturnValue(fake);

    const promise = new ClaudeCodeClient({ binary: "/usr/local/bin/claude-custom" }).complete({
      prompt: "x",
      model: "m",
      temperature: 0,
      maxTokens: 100,
    });

    expect(mockSpawn.mock.calls[0][0]).toBe("/usr/local/bin/claude-custom");

    fake.stdout.emit("data", Buffer.from('{"result":"ok"}'));
    fake.emit("close", 0);
    await promise;
  });

  it("provider id is 'claude_code' and lists subscription models", () => {
    const c = new ClaudeCodeClient();
    expect(c.provider).toBe("claude_code");
    const ids = c.models.map((m) => m.id);
    expect(ids).toContain("claude-sonnet-4-6");
    // Subscription-based: cost fields should be omitted
    expect(c.models[0].costPer1MIn).toBeUndefined();
    expect(c.models[0].costPer1MOut).toBeUndefined();
  });
});
