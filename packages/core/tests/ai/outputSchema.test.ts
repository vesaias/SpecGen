import { describe, expect, it } from "vitest";
import {
  backendEnrichmentSchema,
  eventEnrichmentSchema,
  frontendEnrichmentSchema,
  handlerEnrichmentSchema,
  schemaForItemType,
} from "../../src/ai/outputSchema.js";

describe("backendEnrichmentSchema", () => {
  it("accepts a well-formed enrichment", () => {
    const r = backendEnrichmentSchema.parse({
      summary: "Returns a paginated list of orders.",
      context: "Used by the orders dashboard.",
      orchestration: [
        { step: 1, call: "Validate input", description: "Check that customerId is provided." },
      ],
    });
    expect(r.summary.length).toBeGreaterThan(0);
  });

  it("strips unknown top-level keys", () => {
    const r = backendEnrichmentSchema.parse({
      summary: "x",
      context: "y",
      junk: { malicious: "data" },
    });
    expect((r as Record<string, unknown>).junk).toBeUndefined();
  });

  it("rejects too-long summary (>4000 chars)", () => {
    expect(() =>
      backendEnrichmentSchema.parse({ summary: "x".repeat(4001), context: "y" }),
    ).toThrow();
  });

  it("rejects orchestration step with negative number", () => {
    expect(() =>
      backendEnrichmentSchema.parse({
        summary: "x",
        context: "y",
        orchestration: [{ step: -1, call: "Bad", description: "nope" }],
      }),
    ).toThrow();
  });

  it("requires summary and context", () => {
    expect(() => backendEnrichmentSchema.parse({})).toThrow();
    expect(() => backendEnrichmentSchema.parse({ summary: "" })).toThrow();
  });
});

describe("frontendEnrichmentSchema", () => {
  it("accepts a well-formed enrichment", () => {
    const r = frontendEnrichmentSchema.parse({
      summary: "Order list page.",
      context: "Lets users browse orders.",
    });
    expect(r.summary).toBe("Order list page.");
  });
});

describe("eventEnrichmentSchema", () => {
  it("accepts a well-formed enrichment", () => {
    const r = eventEnrichmentSchema.parse({
      summary: "Raised when an order is cancelled.",
    });
    expect(r.summary.length).toBeGreaterThan(0);
  });

  it("requires summary", () => {
    expect(() => eventEnrichmentSchema.parse({})).toThrow();
  });
});

describe("handlerEnrichmentSchema", () => {
  it("accepts a well-formed enrichment", () => {
    const r = handlerEnrichmentSchema.parse({
      description: "Handles cancellations by refunding all line items.",
    });
    expect(r.description.length).toBeGreaterThan(0);
  });

  it("requires description", () => {
    expect(() => handlerEnrichmentSchema.parse({})).toThrow();
  });
});

describe("schemaForItemType", () => {
  it("returns the right schema for each known item type", () => {
    expect(schemaForItemType("backend-endpoint")).toBe(backendEnrichmentSchema);
    expect(schemaForItemType("backend")).toBe(backendEnrichmentSchema);
    expect(schemaForItemType("frontend-page")).toBe(frontendEnrichmentSchema);
    expect(schemaForItemType("frontend")).toBe(frontendEnrichmentSchema);
    expect(schemaForItemType("domain-event")).toBe(eventEnrichmentSchema);
    expect(schemaForItemType("event")).toBe(eventEnrichmentSchema);
    expect(schemaForItemType("handler")).toBe(handlerEnrichmentSchema);
  });

  it("returns null for unknown item types", () => {
    expect(schemaForItemType("does-not-exist")).toBeNull();
  });
});
