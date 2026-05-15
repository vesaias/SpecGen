import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RunEventBroker, type SeqRunEvent } from "../../src/services/RunEventBroker.js";

function makeBroker(): { broker: RunEventBroker; logsDir: string } {
  const logsDir = mkdtempSync(path.join(tmpdir(), "specgen-broker-"));
  return { broker: new RunEventBroker(logsDir), logsDir };
}

describe("RunEventBroker", () => {
  it("open returns the absolute log path under logsDir", async () => {
    const { broker, logsDir } = makeBroker();
    const logPath = await broker.open("run-a");
    expect(logPath.startsWith(logsDir)).toBe(true);
    expect(logPath.endsWith("run-a.jsonl")).toBe(true);
    await broker.close("run-a");
  });

  it("emit writes a JSONL line + invokes subscribers", async () => {
    const { broker } = makeBroker();
    const logPath = await broker.open("run-b");
    const received: SeqRunEvent[] = [];
    broker.subscribe("run-b", (e) => received.push(e));

    broker.emit("run-b", { type: "progress", message: "step 1" });
    broker.emit("run-b", { type: "warning", message: "slow" });

    await broker.close("run-b");
    expect(received).toHaveLength(2);
    expect(received[0].event).toEqual({ type: "progress", message: "step 1" });
    expect(received[1].event).toEqual({ type: "warning", message: "slow" });
    expect(received[0].seq).toBe(1);
    expect(received[1].seq).toBe(2);

    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({
      seq: 1,
      event: { type: "progress", message: "step 1" },
    });
  });

  it("emit on a non-open run throws", () => {
    const { broker } = makeBroker();
    expect(() => broker.emit("nope", { type: "progress", message: "x" })).toThrow(/no open run/i);
  });

  it("emit on a closed run throws", async () => {
    const { broker } = makeBroker();
    await broker.open("run-c");
    await broker.close("run-c");
    expect(() => broker.emit("run-c", { type: "progress", message: "after close" })).toThrow();
  });

  it("multiple subscribers each receive every event", async () => {
    const { broker } = makeBroker();
    await broker.open("run-d");
    const a: SeqRunEvent[] = [];
    const b: SeqRunEvent[] = [];
    broker.subscribe("run-d", (e) => a.push(e));
    broker.subscribe("run-d", (e) => b.push(e));
    broker.emit("run-d", { type: "progress", message: "1" });
    broker.emit("run-d", { type: "progress", message: "2" });
    await broker.close("run-d");
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);
  });

  it("subscribe returns an unsubscribe function", async () => {
    const { broker } = makeBroker();
    await broker.open("run-e");
    const seen: SeqRunEvent[] = [];
    const off = broker.subscribe("run-e", (e) => seen.push(e));
    broker.emit("run-e", { type: "progress", message: "1" });
    off();
    broker.emit("run-e", { type: "progress", message: "2" });
    await broker.close("run-e");
    expect(seen).toHaveLength(1);
  });

  it("close returns the log path; isOpen flips to false after close", async () => {
    const { broker } = makeBroker();
    const logPath = await broker.open("run-f");
    expect(broker.isOpen("run-f")).toBe(true);
    const returned = await broker.close("run-f");
    expect(returned).toBe(logPath);
    expect(broker.isOpen("run-f")).toBe(false);
  });

  it("isOpen is false for an unknown run id", () => {
    const { broker } = makeBroker();
    expect(broker.isOpen("unknown")).toBe(false);
  });

  it("close on an unknown run returns null", async () => {
    const { broker } = makeBroker();
    expect(await broker.close("unknown")).toBeNull();
  });

  it("replay reads JSONL from disk for an already-closed run", async () => {
    const { broker } = makeBroker();
    await broker.open("run-g");
    broker.emit("run-g", { type: "progress", message: "a" });
    broker.emit("run-g", { type: "progress", message: "b" });
    broker.emit("run-g", {
      type: "done",
      stats: {
        itemsCreated: 1,
        itemsUpdated: 0,
        itemsRemoved: 0,
        warnings: 0,
        aiCalls: [],
        aiCostUsdTotal: 0,
      },
    });
    await broker.close("run-g");

    const events: SeqRunEvent[] = [];
    for await (const e of broker.replay("run-g")) events.push(e);
    expect(events).toHaveLength(3);
    expect(events[0].event).toEqual({ type: "progress", message: "a" });
    expect(events[2].event.type).toBe("done");
  });

  it("replay returns nothing for an unknown run (no log file)", async () => {
    const { broker } = makeBroker();
    const events: SeqRunEvent[] = [];
    for await (const e of broker.replay("never-existed")) events.push(e);
    expect(events).toEqual([]);
  });

  it("replay tolerates trailing newline + ignores empty lines", async () => {
    const { broker, logsDir } = makeBroker();
    // Write a log file directly with a trailing newline + a blank line
    const fs = await import("node:fs");
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(
      path.join(logsDir, "run-h.jsonl"),
      `{"type":"progress","message":"a"}\n\n{"type":"progress","message":"b"}\n`,
      "utf8",
    );
    const events: SeqRunEvent[] = [];
    for await (const e of broker.replay("run-h")) events.push(e);
    expect(events).toHaveLength(2);
  });

  it("logsDir is created if it doesn't exist", async () => {
    const baseDir = mkdtempSync(path.join(tmpdir(), "specgen-broker-base-"));
    const nested = path.join(baseDir, "deep", "logs");
    expect(existsSync(nested)).toBe(false);
    const broker = new RunEventBroker(nested);
    await broker.open("run-i");
    expect(existsSync(nested)).toBe(true);
    await broker.close("run-i");
  });
});
