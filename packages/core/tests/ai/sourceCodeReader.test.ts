import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSourceCode } from "../../src/ai/sourceCodeReader.js";

const tmpRoots: string[] = [];

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "scr-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("readSourceCode", () => {
  it("returns empty string for an empty file list", () => {
    const root = makeRoot();
    expect(readSourceCode([], root)).toBe("");
  });

  it("renders a single small file with the FILE header", () => {
    const root = makeRoot();
    const body = "export const answer = 42;\n";
    writeFileSync(join(root, "a.ts"), body, "utf8");

    const result = readSourceCode(["a.ts"], root);
    expect(result).toBe(`// FILE: a.ts\n${body}`);
  });

  it("joins multiple files with a blank line between entries", () => {
    const root = makeRoot();
    const bodyA = "alpha";
    const bodyB = "beta";
    writeFileSync(join(root, "a.ts"), bodyA, "utf8");
    writeFileSync(join(root, "b.ts"), bodyB, "utf8");

    const result = readSourceCode(["a.ts", "b.ts"], root);
    expect(result).toContain(`// FILE: a.ts\n${bodyA}`);
    expect(result).toContain(`// FILE: b.ts\n${bodyB}`);
    // Separator between the two entries is exactly "\n\n" (blank line).
    expect(result).toBe(`// FILE: a.ts\n${bodyA}\n\n// FILE: b.ts\n${bodyB}`);
  });

  it("truncates a file larger than perFileBytes and appends the truncation marker", () => {
    const root = makeRoot();
    const body = "x".repeat(100);
    writeFileSync(join(root, "big.ts"), body, "utf8");

    const result = readSourceCode(["big.ts"], root, { perFileBytes: 40 });

    // Body kept = 40 bytes, leftover = 60 bytes
    expect(result).toBe(`// FILE: big.ts\n${"x".repeat(40)}\n// ...truncated (60 more bytes)`);
  });

  it("drops later files when the total cap is reached, keeping earlier ones intact", () => {
    const root = makeRoot();
    const bodyA = "A".repeat(50);
    const bodyB = "B".repeat(50);
    const bodyC = "C".repeat(50);
    writeFileSync(join(root, "a.ts"), bodyA, "utf8");
    writeFileSync(join(root, "b.ts"), bodyB, "utf8");
    writeFileSync(join(root, "c.ts"), bodyC, "utf8");

    // Budget large enough for a.ts in full but exhausted before c.ts.
    const result = readSourceCode(["a.ts", "b.ts", "c.ts"], root, {
      perFileBytes: 1024,
      totalBytes: 80,
    });

    // a.ts must be present and intact (no truncation marker on its body).
    expect(result).toContain(`// FILE: a.ts\n${bodyA}`);
    // c.ts must be entirely absent.
    expect(result).not.toContain("// FILE: c.ts");
    expect(result).not.toContain(bodyC);
  });

  it("silently skips missing files", () => {
    const root = makeRoot();
    const body = "present";
    writeFileSync(join(root, "present.ts"), body, "utf8");

    const result = readSourceCode(["missing.ts", "present.ts"], root);
    expect(result).toBe(`// FILE: present.ts\n${body}`);

    // And a list of only missing files returns "".
    expect(readSourceCode(["nope1.ts", "nope2.ts"], root)).toBe("");
  });

  it("silently skips directories passed as file paths", () => {
    const root = makeRoot();
    mkdirSync(join(root, "subdir"));
    writeFileSync(join(root, "real.ts"), "real", "utf8");

    const result = readSourceCode(["subdir", "real.ts"], root);
    expect(result).toBe("// FILE: real.ts\nreal");
  });

  it("truncates at a UTF-8 codepoint boundary instead of emitting U+FFFD", () => {
    const root = makeRoot();
    // 63 bytes of ASCII + "é" (2 bytes, 0xC3 0xA9) = 65 total bytes.
    // A perFileBytes cap of 64 lands between the two bytes of "é", which
    // would yield a U+FFFD replacement char without codepoint-boundary trim.
    const ascii = "x".repeat(63);
    const body = `${ascii}é`;
    const bodyBytes = Buffer.byteLength(body, "utf8");
    expect(bodyBytes).toBe(65);
    writeFileSync(join(root, "u.ts"), body, "utf8");

    const result = readSourceCode(["u.ts"], root, { perFileBytes: 64 });

    // Must NOT contain the replacement character.
    expect(result).not.toContain("�");
    // Should keep only the 63 ASCII bytes, drop the entire 2-byte "é".
    expect(result).toBe(`// FILE: u.ts\n${ascii}\n// ...truncated (2 more bytes)`);
  });

  it("silently skips null/undefined/non-string entries in sourceFiles", () => {
    const root = makeRoot();
    const body = "kept";
    writeFileSync(join(root, "ok.ts"), body, "utf8");
    const bad: any[] = [null, undefined, 42, {}, "", "ok.ts"];
    const result = readSourceCode(bad as string[], root);

    expect(result).toBe(`// FILE: ok.ts\n${body}`);
  });
});
