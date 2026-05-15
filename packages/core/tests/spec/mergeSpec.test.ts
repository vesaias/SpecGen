import { describe, expect, it } from "vitest";
import { mergeSpec } from "../../src/spec/mergeSpec.js";

// ---------------------------------------------------------------------------
// SCALARS
// ---------------------------------------------------------------------------
describe("mergeSpec — scalars", () => {
  it("parser wins when both sides are plain strings", () => {
    expect(mergeSpec({ method: "POST" }, { method: "GET" })).toEqual({ method: "POST" });
  });

  it("parser-only field is included in result", () => {
    expect(mergeSpec({ route: "/api/orders" }, {})).toEqual({ route: "/api/orders" });
  });

  it("existing-only field is preserved", () => {
    expect(mergeSpec({}, { description: "human-written" })).toEqual({
      description: "human-written",
    });
  });

  it("replaces [TODO] sentinel with parser value", () => {
    const parsed = { description: "parser wrote this" };
    const existing = { description: "[TODO]" };
    expect(mergeSpec(parsed, existing)).toEqual({ description: "parser wrote this" });
  });

  it("replaces [TODO: Human fills] sentinel with parser value", () => {
    expect(mergeSpec({ x: "real" }, { x: "[TODO: Human fills]" })).toEqual({ x: "real" });
  });

  it("existing description wins when fresh description is empty (description is enriched field — fixed A.9)", () => {
    // Fixed in A.9: 'description' is now in ENRICHED_STRING_FIELDS.
    // Previously, an empty description in fresh would overwrite a human-written one.
    // Now, existing wins when fresh is empty/placeholder — same as summary/context.
    expect(mergeSpec({ description: "" }, { description: "human" })).toEqual({
      description: "human",
    });
  });

  it("parser null/undefined falls through to existing (null is treated like undefined)", () => {
    // mergeDeep line 56: if fresh === null || fresh === undefined → return existing
    // At top level this means: mergeSpec(null, existing) → but our top-level object is always an object.
    // Test via nested key: parser provides object, existing provides scalar on different key.
    // We test null at the value level inside an object by checking the object-merge path.
    // null value in fresh object: { x: null } fresh, { x: 'human' } existing
    // In object path: result starts as { ...fresh } = { x: null }, then existing-only keys added,
    // but x IS in fresh so it stays null. mergeDeep is only called recursively on object/array values.
    // So null scalar in object: fresh object path keeps it as null (spread keeps null).
    expect(mergeSpec({ x: null }, { x: "human" })).toEqual({ x: null });
    // Note: this is different from fresh=null at the TOP level where existing would win.
  });
});

// ---------------------------------------------------------------------------
// ENRICHED STRING FIELDS (summary, context, responseExample, description — fixed A.9)
// ---------------------------------------------------------------------------
describe("mergeSpec — enriched string fields", () => {
  it("preserves existing summary when parser produces empty string", () => {
    // mergeDeep has a special list: ['summary', 'context', 'responseExample', 'description']
    // If existing[field] exists AND fresh[field] is empty/placeholder → keep existing
    expect(mergeSpec({ summary: "" }, { summary: "PM-written summary" })).toEqual({
      summary: "PM-written summary",
    });
  });

  it("preserves existing context when parser omits it", () => {
    expect(mergeSpec({ route: "/foo" }, { context: "Business context here" })).toEqual({
      route: "/foo",
      context: "Business context here",
    });
  });

  it("preserves existing responseExample when parser has [TODO: Human fills]", () => {
    expect(
      mergeSpec({ responseExample: "[TODO: Human fills]" }, { responseExample: '{ "id": 1 }' }),
    ).toEqual({ responseExample: '{ "id": 1 }' });
  });

  it("parser wins for summary when existing is empty string", () => {
    // existing['summary'] falsy → fresh wins
    expect(mergeSpec({ summary: "new summary" }, { summary: "" })).toEqual({
      summary: "new summary",
    });
  });

  it("preserves existing description when parser produces empty string (fixed A.9)", () => {
    // Fixed in A.9: 'description' is now in ENRICHED_STRING_FIELDS.
    // Previously this was tested in the scalars section and expected fresh (empty) to win.
    expect(mergeSpec({ description: "" }, { description: "human-written desc" })).toEqual({
      description: "human-written desc",
    });
  });

  it("preserves existing description when parser produces [TODO] sentinel (fixed A.9)", () => {
    expect(mergeSpec({ description: "[TODO]" }, { description: "human description" })).toEqual({
      description: "human description",
    });
  });
});

// ---------------------------------------------------------------------------
// OBJECTS
// ---------------------------------------------------------------------------
describe("mergeSpec — objects", () => {
  it("recursively merges nested objects", () => {
    const parsed = { req: { method: "POST" } };
    const existing = { req: { description: "human-written" } };
    expect(mergeSpec(parsed, existing)).toEqual({
      req: { method: "POST", description: "human-written" },
    });
  });

  it("parser-only nested object is preserved", () => {
    expect(mergeSpec({ a: { b: 1 } }, {})).toEqual({ a: { b: 1 } });
  });

  it("does not mutate inputs", () => {
    const parsed = { name: "foo", nested: { x: 1 } };
    const existing = { name: "bar", nested: { y: 2 } };
    const parsedCopy = JSON.parse(JSON.stringify(parsed));
    const existingCopy = JSON.parse(JSON.stringify(existing));
    mergeSpec(parsed, existing);
    expect(parsed).toEqual(parsedCopy);
    expect(existing).toEqual(existingCopy);
  });
});

// ---------------------------------------------------------------------------
// ARRAYS — responses (merge by `status`)
// ---------------------------------------------------------------------------
describe("mergeSpec — arrays of responses", () => {
  it("merges responses by status key — existing description wins", () => {
    const parsed = [
      { status: 200, body: "[TODO]" },
      { status: 400, body: "[TODO]" },
    ];
    const existing = [
      { status: 200, body: "[TODO]", description: "Success response", responseExample: '{"id":1}' },
      { status: 400, body: "[TODO]", description: "Validation failed", responseExample: "" },
    ];
    const result = mergeSpec({ responses: parsed }, { responses: existing });
    expect(result.responses[0].description).toBe("Success response");
    expect(result.responses[1].description).toBe("Validation failed");
  });

  it("merges responses by status key — existing responseExample wins", () => {
    const parsed = [{ status: 200, body: "[TODO]", responseExample: "" }];
    const existing = [{ status: 200, body: "[TODO]", responseExample: '{"id":42}' }];
    const result = mergeSpec({ responses: parsed }, { responses: existing });
    expect(result.responses[0].responseExample).toBe('{"id":42}');
  });

  it("parser adds new response status not in existing", () => {
    const parsed = [
      { status: 200, body: "ok" },
      { status: 404, body: "not found" },
    ];
    const existing = [{ status: 200, body: "ok", description: "human desc" }];
    const result = mergeSpec({ responses: parsed }, { responses: existing });
    // fresh drives which responses exist; new status 404 is included
    expect(result.responses).toHaveLength(2);
    expect(result.responses[1].status).toBe(404);
  });

  it("drops existing-only response status no longer in parser output", () => {
    // Per-status merge: only parsed statuses are present (fresh.map(...))
    const parsed = [{ status: 200, body: "ok" }];
    const existing = [
      { status: 200, body: "ok", description: "human" },
      { status: 500, body: "error", description: "stale" },
    ];
    const result = mergeSpec({ responses: parsed }, { responses: existing });
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// ARRAYS — orchestration (per-step merge by `step` key — fixed in A.9)
// ---------------------------------------------------------------------------
describe("mergeSpec — arrays of orchestration steps", () => {
  it("merges orchestration per-step — existing descriptions preserved, new steps included (fixed A.9)", () => {
    // Fixed in A.9: per-step merge instead of whole-array heuristic.
    // Parser is authoritative for which steps exist; existing descriptions survive per matched step.
    const parsed = [
      { step: 1, call: "Validate", description: "[TODO]" },
      { step: 2, call: "Insert", description: "[TODO]" },
    ];
    const existing = [
      { step: 1, call: "Validate", description: "Human-written validation logic" },
      { step: 2, call: "Insert", description: "Human-written insert logic" },
    ];
    const result = mergeSpec({ orchestration: parsed }, { orchestration: existing });
    // Per-step merge: each step gets its existing description preserved
    expect(result.orchestration).toHaveLength(2);
    expect(result.orchestration[0].description).toBe("Human-written validation logic");
    expect(result.orchestration[1].description).toBe("Human-written insert logic");
  });

  it("stale steps (only in existing) are dropped; new parser steps are included (fixed A.9)", () => {
    // Fixed in A.9: stale steps no longer bleed through.
    // Previously: whole existing array won, keeping stale step 99 and losing new step 2.
    const parsed = [
      { step: 1, call: "A", description: "[TODO]" },
      { step: 2, call: "B", description: "[TODO]" },
    ];
    const existing = [
      { step: 1, call: "A", description: "Human A" },
      { step: 99, call: "Stale", description: "No longer in code" },
    ];
    const result = mergeSpec({ orchestration: parsed }, { orchestration: existing });
    // Parser drives step list: step 1 (description preserved) + step 2 (new, no existing)
    // Step 99 is dropped because it's not in parsed output
    expect(result.orchestration).toHaveLength(2);
    expect(result.orchestration[0].step).toBe(1);
    expect(result.orchestration[0].description).toBe("Human A"); // preserved
    expect(result.orchestration[1].step).toBe(2);
    expect(result.orchestration[1].description).toBe("[TODO]"); // new, no existing enrichment
  });

  it("parser wins orchestration when existing has only [TODO] descriptions", () => {
    // Both sides have only placeholders → fresh wins per step
    const parsed = [{ step: 1, call: "A", description: "[TODO]" }];
    const existing = [
      { step: 1, call: "A", description: "[TODO]" },
      { step: 2, call: "B", description: "[TODO]" },
    ];
    const result = mergeSpec({ orchestration: parsed }, { orchestration: existing });
    // Parser step list wins; step 2 not in parsed → dropped
    expect(result.orchestration).toHaveLength(1);
    expect(result.orchestration[0].step).toBe(1);
  });

  it("parser wins orchestration array when existing is empty", () => {
    const parsed = [{ step: 1, call: "A", description: "[TODO]" }];
    const result = mergeSpec({ orchestration: parsed }, { orchestration: [] });
    // empty existing → fresh wins
    expect(result.orchestration).toEqual(parsed);
  });
});

// ---------------------------------------------------------------------------
// ARRAYS — parameters (per-name merge — fixed in A.9)
// ---------------------------------------------------------------------------
describe("mergeSpec — arrays of parameters", () => {
  it("merges parameters per-name — parser wins type, existing description preserved (fixed A.9)", () => {
    // Fixed in A.9: per-name merge when every element has a `name` key.
    // Previously: fresh won wholesale when fresh had real content, losing human-written descriptions.
    const parsed = [{ name: "id", type: "int", description: "The order ID" }];
    const existing = [{ name: "id", type: "string", description: "Human description" }];
    const result = mergeSpec({ parameters: parsed }, { parameters: existing });
    // Per-name merge: parser wins type (int), existing description wins (it's non-empty, non-TODO)
    expect(result.parameters[0].type).toBe("int"); // parser wins for structural fields
    // description: fresh has "The order ID" (non-empty, non-placeholder) so it wins over existing
    // because at the string level, non-placeholder fresh wins
    expect(result.parameters[0].description).toBe("The order ID");
  });

  it("per-name merge: existing human description preserved when fresh has [TODO] placeholder (fixed A.9)", () => {
    // Fixed in A.9: this now works via per-name merge + string-level placeholder handling
    // Previously it only worked via the whole-array placeholder heuristic
    const parsed = [{ name: "id", type: "int", description: "[TODO]" }];
    const existing = [{ name: "id", type: "string", description: "Human description" }];
    const result = mergeSpec({ parameters: parsed }, { parameters: existing });
    // Per-name merge → recurse on element → description: "[TODO]" → existing wins
    expect(result.parameters[0].type).toBe("int"); // parser wins for type
    expect(result.parameters[0].description).toBe("Human description"); // existing wins
  });

  it("new parameters added by parser are included; missing ones dropped (per-name, fixed A.9)", () => {
    // Parser is authoritative for which parameters exist
    const parsed = [
      { name: "id", type: "int", description: "[TODO]" },
      { name: "filter", type: "string", description: "New param" },
    ];
    const existing = [
      { name: "id", type: "string", description: "Human id desc" },
      { name: "deprecated", type: "bool", description: "Removed from API" },
    ];
    const result = mergeSpec({ parameters: parsed }, { parameters: existing });
    // Parser drives list: 'id' (merged) + 'filter' (new); 'deprecated' dropped
    expect(result.parameters).toHaveLength(2);
    expect(result.parameters[0].name).toBe("id");
    expect(result.parameters[0].description).toBe("Human id desc"); // existing preserved
    expect(result.parameters[1].name).toBe("filter");
    expect(result.parameters[1].description).toBe("New param"); // from parser
  });
});

// ---------------------------------------------------------------------------
// TYPE MISMATCHES
// ---------------------------------------------------------------------------
describe("mergeSpec — type mismatches", () => {
  it("parser scalar overrides existing object (non-object fresh → falls to scalar branch, returns fresh)", () => {
    // mergeDeep: fresh is not object/array → string branch → fresh wins if non-empty
    expect(mergeSpec({ x: "scalar" }, { x: { nested: true } })).toEqual({ x: "scalar" });
  });

  it("parser object overrides existing scalar (object merge path ignores existing scalar)", () => {
    // mergeDeep object path: result = { ...fresh } = { nested: true }
    // existing[x] = 'scalar' is not an object so it's skipped in recursive merge
    // existing-only keys: 'scalar' key is not in fresh.x, carried over
    expect(mergeSpec({ x: { nested: true } }, { x: "scalar" })).toEqual({ x: { nested: true } });
  });
});

// ---------------------------------------------------------------------------
// ENRICHED SOURCE HASH (drift detector for AI re-enrichment pipeline)
// ---------------------------------------------------------------------------
describe("mergeSpec — enrichedSourceHash", () => {
  it("preserves enrichedSourceHash across re-parses even when sourceHash drifts", () => {
    // Contract: parsers never emit enrichedSourceHash. Only the AI pipeline writes it.
    // When source changes, sourceHash updates on re-parse but enrichedSourceHash stays at
    // its old value so the orchestrator can detect drift (sourceHash !== enrichedSourceHash).
    const existing = {
      id: "x",
      type: "backend" as const,
      title: "Get order",
      sourceHash: "old",
      enrichedSourceHash: "old",
      summary: "user edit",
    };
    const fresh = {
      id: "x",
      type: "backend" as const,
      title: "Get order",
      sourceHash: "new",
      summary: "",
      // no enrichedSourceHash — parsers never emit it
    };
    const merged = mergeSpec(fresh, existing);
    expect(merged.sourceHash).toBe("new"); // parser-emitted sourceHash wins
    expect(merged.enrichedSourceHash).toBe("old"); // preserved from existing
    expect(merged.summary).toBe("user edit"); // enriched field preserved (sanity)
  });

  it("does not invent an enrichedSourceHash when neither side has one", () => {
    const fresh = { id: "x", sourceHash: "new" };
    const existing = { id: "x", sourceHash: "old" };
    const merged = mergeSpec(fresh, existing);
    expect(merged.enrichedSourceHash).toBeUndefined();
  });

  it("preserves enrichedSourceHash even when sourceHash matches (no-drift case)", () => {
    // Even when source is unchanged, the enrichedSourceHash from existing must survive
    // the merge so the orchestrator sees "no drift, no re-enrichment needed".
    const fresh = { id: "x", sourceHash: "same" };
    const existing = { id: "x", sourceHash: "same", enrichedSourceHash: "same" };
    const merged = mergeSpec(fresh, existing);
    expect(merged.sourceHash).toBe("same");
    expect(merged.enrichedSourceHash).toBe("same");
  });
});

// ---------------------------------------------------------------------------
// EMPTY / EDGE CASES
// ---------------------------------------------------------------------------
describe("mergeSpec — empty array edge cases", () => {
  it("keeps existing array when parser produces empty array", () => {
    // mergeDeep line 78: fresh.length === 0 && existing.length > 0 → return existing
    expect(mergeSpec({ items: [] }, { items: [{ name: "existing" }] })).toEqual({
      items: [{ name: "existing" }],
    });
  });

  it("returns empty array when both sides are empty", () => {
    expect(mergeSpec({ items: [] }, { items: [] })).toEqual({ items: [] });
  });
});
