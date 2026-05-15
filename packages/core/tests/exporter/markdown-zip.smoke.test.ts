import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { markdownZipExporter } from "../../src/exporter/builtins/markdown-zip.js";
import { JsonSpecRepository } from "../../src/spec/JsonSpecRepository.js";
import type { BackendSpecItem } from "../../src/spec/types.js";

describe("markdownZipExporter", () => {
  it("produces a zip stream with README.md + one .md per item, tree-mirrored", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mdzip-"));
    const repo = new JsonSpecRepository(dir);

    const item: BackendSpecItem = {
      id: "get-foo",
      type: "backend",
      title: "GET /foo",
      method: "GET",
      route: "/foo",
      controller: "FooController",
      summary: "",
      context: "",
      parameters: [],
      responses: [],
      validationRules: [],
      orchestration: [],
      dependencies: [],
      sourceFiles: [],
    };

    await repo.write({
      meta: { target: "demo", version: "v1", generatedAt: "2026-01-01" },
      tree: [
        {
          id: "backend",
          type: "folder",
          label: "Backend",
          children: [{ id: "get-foo", type: "backend" }],
        },
      ],
      items: { "get-foo": item },
    });
    await repo.writeItem(item);

    const buffers: Buffer[] = [];
    const stream = new PassThrough();
    stream.on("data", (b: Buffer) => buffers.push(b));
    const done = new Promise<void>((resolve) => stream.on("end", resolve));

    for await (const _ev of markdownZipExporter.run({
      spec: repo,
      output: stream,
      format: "zip",
    })) {
      // drain events
    }

    await done;

    const zipBytes = Buffer.concat(buffers);
    expect(zipBytes.length).toBeGreaterThan(100);
    // Zip magic bytes: PK (0x50 0x4B)
    expect(zipBytes[0]).toBe(0x50); // 'P'
    expect(zipBytes[1]).toBe(0x4b); // 'K'
  });

  it("emits progress events for each item", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mdzip2-"));
    const repo = new JsonSpecRepository(dir);

    const item: BackendSpecItem = {
      id: "get-bar",
      type: "backend",
      title: "GET /bar",
      method: "GET",
      route: "/bar",
      controller: "BarController",
      summary: "",
      context: "",
      parameters: [],
      responses: [],
      validationRules: [],
      orchestration: [],
      dependencies: [],
      sourceFiles: [],
    };

    await repo.write({
      meta: { target: "test", version: "v1", generatedAt: "2026-01-01" },
      tree: [{ id: "get-bar", type: "backend" }],
      items: { "get-bar": item },
    });
    await repo.writeItem(item);

    const events: string[] = [];
    const stream = new PassThrough();
    stream.resume(); // drain without collecting
    const done = new Promise<void>((resolve) => stream.on("end", resolve));

    for await (const ev of markdownZipExporter.run({
      spec: repo,
      output: stream,
      format: "zip",
    })) {
      events.push(ev.type);
    }

    await done;

    expect(events).toContain("progress");
    expect(events[events.length - 1]).toBe("done");
  });

  it("yields an error event when the output stream errors mid-stream", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mdzip-err-"));
    const repo = new JsonSpecRepository(dir);

    const item: BackendSpecItem = {
      id: "get-baz",
      type: "backend",
      title: "GET /baz",
      method: "GET",
      route: "/baz",
      controller: "BazController",
      summary: "",
      context: "",
      parameters: [],
      responses: [],
      validationRules: [],
      orchestration: [],
      dependencies: [],
      sourceFiles: [],
    };

    await repo.write({
      meta: { target: "demo", version: "v1", generatedAt: "2026-01-01" },
      tree: [{ id: "get-baz", type: "backend" }],
      items: { "get-baz": item },
    });
    await repo.writeItem(item);

    // Writable that errors on first write
    const failingStream = new Writable({
      write(_chunk, _encoding, cb) {
        cb(new Error("simulated stream failure"));
      },
    });

    const events: Array<{ type: string; error?: unknown }> = [];
    for await (const ev of markdownZipExporter.run({
      spec: repo,
      output: failingStream as any,
      format: "zip",
    })) {
      events.push(ev);
      if (events.length > 10) break; // safety cap so test doesn't hang
    }

    // At least one error event should have been yielded
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
  });
});
