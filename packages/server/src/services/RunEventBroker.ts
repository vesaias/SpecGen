import { EventEmitter } from "node:events";
import { promises as fs, type WriteStream, createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { RunEvent } from "@specgen/core";

interface BrokerEntry {
  emitter: EventEmitter;
  writer: WriteStream;
  logPath: string;
  closed: boolean;
  /** Monotonic per-run sequence number; used by SSE subscribers to dedupe across replay/live. */
  seq: number;
}

/** RunEvent annotated with its monotonic per-run sequence number. */
export interface SeqRunEvent {
  seq: number;
  event: RunEvent;
}

/**
 * Routes generator events from a single producer (RunWorker) to many consumers
 * (SSE clients) AND persists each event to a JSONL log file for later replay.
 *
 * Lifecycle:
 *   open(runId)    → returns log path; makes runId 'open'
 *   emit(runId, e) → writes JSONL + emits to subscribers; throws if not open
 *   subscribe()    → returns an unsubscribe fn
 *   close(runId)   → flushes file, marks closed, removes entry
 *   replay(runId)  → async generator from disk (works after close)
 */
/**
 * Convert Error instances inside a RunEvent into plain `{ message, stack }`
 * objects so JSON.stringify produces something readable instead of "{}"
 * (Error's own properties are non-enumerable).
 */
function normalizeEventForSerialization(event: RunEvent): RunEvent {
  if (event.type === "error" && event.error instanceof Error) {
    const err = event.error;
    return {
      ...event,
      error: { message: err.message, stack: err.stack } as unknown as Error,
    };
  }
  return event;
}

export class RunEventBroker {
  private readonly entries = new Map<string, BrokerEntry>();

  constructor(private readonly logsDir: string) {}

  async open(runId: string): Promise<string> {
    await fs.mkdir(this.logsDir, { recursive: true });
    const logPath = path.join(this.logsDir, `${runId}.jsonl`);
    const writer = createWriteStream(logPath, { flags: "a" });
    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);
    this.entries.set(runId, { emitter, writer, logPath, closed: false, seq: 0 });
    return logPath;
  }

  emit(runId: string, event: RunEvent): void {
    const entry = this.entries.get(runId);
    if (!entry) throw new Error(`no open run: ${runId}`);
    if (entry.closed) throw new Error(`run already closed: ${runId}`);
    const seq = ++entry.seq;
    // Normalize Error instances so they survive JSON.stringify — Error's
    // own properties are non-enumerable, so the default serialization is "{}".
    const normalized = normalizeEventForSerialization(event);
    const wrapped: SeqRunEvent = { seq, event: normalized };
    entry.writer.write(`${JSON.stringify(wrapped)}\n`);
    entry.emitter.emit("event", wrapped);
  }

  /**
   * Subscribe to live events for an open run. Listener receives `{seq, event}`
   * so SSE handlers can dedupe events that also appear in the disk replay.
   */
  subscribe(runId: string, listener: (e: SeqRunEvent) => void): () => void {
    const entry = this.entries.get(runId);
    if (!entry) return () => undefined;
    entry.emitter.on("event", listener);
    return () => entry.emitter.off("event", listener);
  }

  async close(runId: string): Promise<string | null> {
    const entry = this.entries.get(runId);
    if (!entry) return null;
    entry.closed = true;
    await new Promise<void>((resolve, reject) => {
      entry.writer.on("error", reject);
      entry.writer.end(resolve);
    });
    this.entries.delete(runId);
    return entry.logPath;
  }

  /**
   * Async iterate over persisted events. Yields `{seq, event}`. Older logs
   * (written before sequence numbering) are migrated on the fly: their lines
   * are plain RunEvent objects, so we synthesize seq numbers (1, 2, …).
   */
  async *replay(runId: string): AsyncGenerator<SeqRunEvent> {
    const logPath = path.join(this.logsDir, `${runId}.jsonl`);
    try {
      await fs.access(logPath);
    } catch {
      return; // ENOENT — no log file
    }
    const stream = createReadStream(logPath);
    const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    let fallbackSeq = 0;
    try {
      for await (const line of rl) {
        if (line.trim().length === 0) continue;
        try {
          const parsed = JSON.parse(line) as RunEvent | SeqRunEvent;
          if (
            typeof (parsed as SeqRunEvent).seq === "number" &&
            (parsed as SeqRunEvent).event &&
            typeof (parsed as SeqRunEvent).event === "object"
          ) {
            yield parsed as SeqRunEvent;
          } else {
            yield { seq: ++fallbackSeq, event: parsed as RunEvent };
          }
        } catch {
          // skip malformed line
        }
      }
    } finally {
      stream.destroy();
    }
  }

  isOpen(runId: string): boolean {
    const entry = this.entries.get(runId);
    return Boolean(entry && !entry.closed);
  }
}
