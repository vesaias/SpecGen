/**
 * mergeAiEnrichment — Apply an AI-produced enrichment payload onto an existing
 * item record while preserving user hand-edits to map-valued fields.
 *
 * Problem this solves: `Object.assign(itemRec, validated.data)` is one level
 * deep. If the AI returns `sectionDescriptions: { foo: "..." }` and the
 * existing item has `sectionDescriptions: { foo: "old AI text", bar: "user-
 * edited prose" }`, the entire object is shallow-replaced — the user's `bar`
 * key is gone. Same risk on `parameterDescriptions`, `responseExamples`,
 * `actionDescriptions`.
 *
 * Strategy: for the four documented Record<string,string> enrichment fields
 * we merge keys (AI wins on the keys it returns, existing wins on the keys
 * it omits). Every other top-level field uses the previous shallow-replace
 * semantic (AI value wins) — those fields are owned by the AI schema and
 * users don't hand-edit them in place.
 */

/** Fields whose payload is `Record<string, string>` per the AI output schema. */
const RECORD_FIELDS = new Set([
  "sectionDescriptions",
  "actionDescriptions",
  "parameterDescriptions",
  "responseExamples",
]);

/**
 * Merge AI enrichment data into the in-memory item record. Mutates `itemRec`
 * in place (caller is expected to persist via `spec.writeItem` afterwards).
 *
 * - For keys NOT in `validated`: itemRec is unchanged.
 * - For keys in `validated` whose value is a Record<string,string> per
 *   {@link RECORD_FIELDS}: existing[key] is merged with validated[key],
 *   validated keys winning on conflict; existing keys absent from validated
 *   are preserved.
 * - For every other key in `validated`: validated[key] replaces existing[key]
 *   (shallow), matching the prior `Object.assign` behaviour.
 */
export function mergeAiEnrichment(
  itemRec: Record<string, unknown>,
  validated: Record<string, unknown>,
): void {
  for (const [key, aiValue] of Object.entries(validated)) {
    if (
      RECORD_FIELDS.has(key) &&
      aiValue &&
      typeof aiValue === "object" &&
      !Array.isArray(aiValue)
    ) {
      const existing = itemRec[key];
      if (existing && typeof existing === "object" && !Array.isArray(existing)) {
        itemRec[key] = {
          ...(existing as Record<string, unknown>),
          ...(aiValue as Record<string, unknown>),
        };
        continue;
      }
    }
    itemRec[key] = aiValue;
  }
}
