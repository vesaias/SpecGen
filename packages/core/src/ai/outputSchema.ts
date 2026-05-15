import { z } from "zod";

const SHORT_TEXT_MAX = 4000;
const LONG_TEXT_MAX = 16000;

export const backendEnrichmentSchema = z
  .object({
    summary: z.string().min(1).max(SHORT_TEXT_MAX),
    context: z.string().min(1).max(SHORT_TEXT_MAX),
    orchestration: z
      .array(
        z.object({
          step: z.number().int().nonnegative(),
          call: z.string().min(1).max(200),
          description: z.string().min(1).max(LONG_TEXT_MAX),
        }),
      )
      .optional(),
    parameterDescriptions: z.record(z.string().max(SHORT_TEXT_MAX)).optional(),
    responseExamples: z.record(z.string().max(LONG_TEXT_MAX)).optional(),
  })
  .strip();

export type BackendEnrichment = z.infer<typeof backendEnrichmentSchema>;

export const frontendEnrichmentSchema = z
  .object({
    summary: z.string().min(1).max(SHORT_TEXT_MAX),
    context: z.string().min(1).max(SHORT_TEXT_MAX),
    sectionDescriptions: z.record(z.string().max(SHORT_TEXT_MAX)).optional(),
    onLoadDescription: z.string().max(LONG_TEXT_MAX).optional(),
    actionDescriptions: z.record(z.string().max(SHORT_TEXT_MAX)).optional(),
  })
  .strip();

export type FrontendEnrichment = z.infer<typeof frontendEnrichmentSchema>;

export const eventEnrichmentSchema = z
  .object({
    summary: z.string().min(1).max(SHORT_TEXT_MAX),
    context: z.string().max(SHORT_TEXT_MAX).optional(),
    payloadDescription: z.string().max(LONG_TEXT_MAX).optional(),
    triggerDescription: z.string().max(SHORT_TEXT_MAX).optional(),
    handlerDescription: z.string().max(LONG_TEXT_MAX).optional(),
  })
  .strip();

export type EventEnrichment = z.infer<typeof eventEnrichmentSchema>;

export const handlerEnrichmentSchema = z
  .object({
    description: z.string().min(1).max(LONG_TEXT_MAX),
    listensTo: z.array(z.string().min(1).max(200)).optional(),
    logic: z.string().max(LONG_TEXT_MAX).optional(),
  })
  .strip();

export type HandlerEnrichment = z.infer<typeof handlerEnrichmentSchema>;

/**
 * Look up the schema for a given item type. Returns null for unknown types.
 * Accepts both short ('backend') and long ('backend-endpoint') item-type names
 * to match what parsers and generators may emit.
 */
/**
 * Map a parser's short item-type ('backend', 'frontend', 'event') to the
 * canonical long form used by profile prompt filenames and schema lookups.
 * Unknown types are returned unchanged.
 */
export function canonicalItemType(itemType: string): string {
  switch (itemType) {
    case "backend":
      return "backend-endpoint";
    case "frontend":
      return "frontend-page";
    case "event":
      return "domain-event";
    default:
      return itemType;
  }
}

export function schemaForItemType(itemType: string): z.ZodTypeAny | null {
  switch (itemType) {
    case "backend":
    case "backend-endpoint":
      return backendEnrichmentSchema;
    case "frontend":
    case "frontend-page":
      return frontendEnrichmentSchema;
    case "event":
    case "domain-event":
      return eventEnrichmentSchema;
    case "handler":
      return handlerEnrichmentSchema;
    default:
      return null;
  }
}
