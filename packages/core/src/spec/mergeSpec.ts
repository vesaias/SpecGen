/**
 * mergeSpec — Merge a freshly-parsed spec object with an existing (possibly human-edited) one.
 *
 * Rules (locked in by regression tests; ported from specgen/index.ts:mergeDeep):
 *
 * 1. fresh === null || fresh === undefined → existing wins (no overwrite with nothing)
 *
 * 2. Both sides are strings:
 *    - fresh is empty (''), [TODO], or [TODO: Human fills] → existing wins (treat as placeholder)
 *    - otherwise → fresh wins (parser is authoritative for structural data)
 *
 * 3. Special enriched string fields at the object level ('summary', 'context', 'responseExample',
 *    'description'):
 *    - If existing has a non-empty value AND fresh is empty/placeholder → existing wins
 *    - These fields are treated as "AI/human enriched" even when accessed via object merge
 *    - Fixed in A.9: 'description' is now included (previously only summary/context/responseExample)
 *
 * 4. Arrays of objects with a `.status` field (responses):
 *    - Merge per-element by `status` key — parser drives which statuses exist
 *    - For matched elements: fresh structure wins, but existing `responseExample` and
 *      `description` are preserved if non-empty
 *    - Existing-only statuses are dropped (parser is authoritative for which responses exist)
 *
 * 5. Arrays of objects with a `.step` field (orchestration):
 *    - Fixed in A.9: per-step merge by `step` key (was: whole-array heuristic)
 *    - Parser is authoritative for which steps exist (existing-only steps are dropped)
 *    - For each matched step, existing description/enriched fields are preserved via mergeDeep
 *    - Steps are sorted by step number in the output
 *
 * 6. Arrays whose elements ALL have a `name` key (parameters, payload fields, etc.):
 *    - Fixed in A.9: per-name merge (was: general all-placeholder heuristic)
 *    - Parser is authoritative for which parameters exist
 *    - For each matched parameter, existing enriched fields (description, etc.) are preserved
 *
 * 7. General array heuristic (validationRules, etc. — not matched by rules 4–6):
 *    - fresh is empty + existing has content → existing wins
 *    - fresh is all-placeholder (every element has empty/[TODO] description) AND existing has
 *      any real content → existing wins
 *    - otherwise → fresh wins
 *
 * 8. Both sides plain object → merge recursively per-key (parser drives structure,
 *    existing-only keys are carried over)
 *
 * 9. Type mismatch (e.g. fresh is scalar, existing is object) → fresh wins
 *
 * Return value: a new object — does NOT mutate inputs.
 */

import { isTodoSentinel } from "./sentinels.js";

// String fields treated as "enriched" — existing wins when fresh is empty/placeholder
// Fixed in A.9: added 'description' (was missing, causing empty-string descriptions to lose human edits)
const ENRICHED_STRING_FIELDS = ["summary", "context", "responseExample", "description"] as const;

// ---------------------------------------------------------------------------
// Array classification helpers
// ---------------------------------------------------------------------------

function isObjectWithKey(e: unknown, key: string): e is Record<string, unknown> {
  return typeof e === "object" && e !== null && key in e;
}

function hasStepKey(arr: unknown[]): boolean {
  return arr.length > 0 && arr.every((e) => isObjectWithKey(e, "step"));
}

function hasNameKey(arr: unknown[]): boolean {
  return arr.length > 0 && arr.every((e) => isObjectWithKey(e, "name"));
}

function hasStatusKey(arr: unknown[]): boolean {
  return arr.length > 0 && arr.every((e) => isObjectWithKey(e, "status"));
}

/**
 * Internal recursive workhorse.
 * @param fresh  Freshly parsed value (parser's current view of the code)
 * @param existing Previously stored value (may contain human/AI edits)
 */
function mergeDeepInternal(fresh: any, existing: any): any {
  // Rule 1: fresh absent → existing wins
  if (fresh === null || fresh === undefined) return existing;

  if (typeof fresh !== "object" || Array.isArray(fresh)) {
    // Rule 2: string merge
    if (typeof fresh === "string" && typeof existing === "string") {
      if (fresh === "" || isTodoSentinel(fresh)) return existing;
      return fresh;
    }

    // Array merge
    if (Array.isArray(fresh) && Array.isArray(existing)) {
      // Rule 4: responses — merge by `status` key
      if (hasStatusKey(fresh)) {
        // fresh is narrowed to Record<string,unknown>[] by hasStatusKey
        const freshStatuses = fresh as Record<string, unknown>[];
        return freshStatuses.map((f) => {
          const match = existing.find(
            (e) => isObjectWithKey(e, "status") && e.status === f.status,
          ) as Record<string, unknown> | undefined;
          if (!match) return f;
          // Preserve enriched fields from existing; fresh wins for everything else
          return {
            ...f,
            responseExample: match.responseExample || f.responseExample,
            description: match.description || f.description,
          };
        });
      }

      // Rule 6a: empty fresh + non-empty existing → existing wins
      if (fresh.length === 0 && existing.length > 0) return existing;

      // Rule 5 (Fixed A.9): orchestration — per-step merge by `step` key
      // Parser is authoritative for which steps exist; existing descriptions are preserved per step.
      // Previously this was a whole-array heuristic that kept stale steps and lost new steps.
      if (hasStepKey(fresh)) {
        // fresh is narrowed to Record<string,unknown>[] by hasStepKey
        const freshSteps = fresh as Record<string, unknown>[];
        const existingByStep = new Map<unknown, Record<string, unknown>>();
        for (const e of existing) {
          if (isObjectWithKey(e, "step")) existingByStep.set(e.step, e);
        }
        return freshSteps
          .map((f) => {
            const match = existingByStep.get(f.step);
            if (!match) return f;
            return mergeDeepInternal(f, match);
          })
          .sort((a, b) => (a.step as number) - (b.step as number));
      }

      // Rule 6 (Fixed A.9): parameters and other named arrays — per-name merge
      // Parser is authoritative for which parameters exist; existing descriptions are preserved.
      // Previously all parameters were replaced wholesale when fresh had real content.
      if (hasNameKey(fresh)) {
        // fresh is narrowed to Record<string,unknown>[] by hasNameKey
        const freshNamed = fresh as Record<string, unknown>[];
        const existingByName = new Map<unknown, Record<string, unknown>>();
        for (const e of existing) {
          if (isObjectWithKey(e, "name")) existingByName.set(e.name, e);
        }
        return freshNamed.map((f) => {
          const match = existingByName.get(f.name);
          if (!match) return f;
          return mergeDeepInternal(f, match);
        });
      }

      // Rule 7: general all-placeholder heuristic (validationRules, etc.)
      if (fresh.length > 0 && existing.length > 0) {
        const freshIsPlaceholder = fresh.every((f) => {
          if (!isObjectWithKey(f, "description")) return true;
          return !f.description || f.description === "[TODO]" || f.description === "";
        });
        const existingHasReal = existing.some((e) => {
          if (!isObjectWithKey(e, "description")) return false;
          return e.description && e.description !== "[TODO]" && e.description !== "";
        });
        if (freshIsPlaceholder && existingHasReal) return existing;
      }

      // Default: fresh wins
      return fresh;
    }

    // Rule 9: type mismatch or non-string scalar → fresh wins
    return fresh;
  }

  // Rule 8: object merge — start with fresh as base (does not mutate fresh)
  const result: Record<string, unknown> = { ...fresh };

  // Rule 3: special enriched string fields — existing wins when fresh is absent/placeholder
  // Fixed in A.9: 'description' is now included in the enriched fields list
  for (const field of ENRICHED_STRING_FIELDS) {
    const fVal = (fresh as Record<string, unknown>)[field];
    const eVal = (existing as Record<string, unknown>)[field];
    if (eVal && (!fVal || fVal === "" || isTodoSentinel(fVal as string))) {
      result[field] = eVal;
    }
  }

  // enrichedSourceHash: always preserve existing value when present.
  // Parsers never emit this field — it's written only by the AI enrichment pipeline.
  // Even when sourceHash drifts (source changed), enrichedSourceHash stays put until
  // the next successful AI run updates it. This is the drift detector contract:
  //   sourceHash !== enrichedSourceHash  ⇒  item needs re-enrichment
  const existingEnrichedHash = (existing as Record<string, unknown>).enrichedSourceHash;
  if (typeof existingEnrichedHash === "string") {
    result.enrichedSourceHash = existingEnrichedHash;
  }

  // Recurse into array and object values present in fresh
  for (const key of Object.keys(fresh as object)) {
    const fVal = (fresh as Record<string, unknown>)[key];
    const eVal = (existing as Record<string, unknown>)[key];
    if (Array.isArray(fVal) && Array.isArray(eVal)) {
      result[key] = mergeDeepInternal(fVal, eVal);
    } else if (
      typeof fVal === "object" &&
      fVal !== null &&
      !Array.isArray(fVal) &&
      typeof eVal === "object" &&
      eVal !== null &&
      !Array.isArray(eVal)
    ) {
      result[key] = mergeDeepInternal(fVal, eVal);
    }
  }

  // Carry over existing-only keys (fields added by human/AI not present in fresh)
  for (const key of Object.keys(existing as object)) {
    if (!(key in (fresh as object)) && (existing as Record<string, unknown>)[key] !== undefined) {
      result[key] = (existing as Record<string, unknown>)[key];
    }
  }

  return result;
}

/**
 * Merge a freshly-parsed spec object with an existing (possibly human-edited) one.
 * See top-of-file comment for the full rule set.
 *
 * @param parsed   The object produced by the parser (reflects current code state)
 * @param existing The previously stored object (may contain human or AI-written edits)
 * @returns        A new merged object; neither input is mutated
 */
export function mergeSpec<T extends object>(parsed: T, existing: Partial<T>): T {
  return mergeDeepInternal(parsed, existing) as T;
}
