# Frontend Page Enrichment

Schema for a single frontend page/screen. The parsers already extracted route, sections, navigation, actions, state, and apiCalls. When the page has been captured by a real browser, the Item JSON ALSO contains live observations under `observedSections`, `observedApiCalls`, `observedTitle`, `landedH1`, `landedUrl`, and `captureNavStatus`. Use them.

### Schema

```jsonc
{
  "summary": "<string, 1 sentence, max 200 chars>",        // REQUIRED — what this page shows
  "context": "<string, 2-3 sentences>",                    // REQUIRED — how the user gets here, why it exists
  "sectionDescriptions": {                                 // OPTIONAL — keyed by the section `id` from the Item JSON
    "<sectionId>": "<plain-language description>"
  },
  "onLoadDescription": "<string>",                         // OPTIONAL — what happens when the page mounts (which API calls, what gets populated)
  "actionDescriptions": {                                  // OPTIONAL — keyed by the action `trigger` from the Item JSON
    "<triggerLabel>": "<plain-language description of what happens on this action>"
  }
}
```

### Field rules

- **summary** — one business-language sentence. Friendly name, not technical. Describe what the page is for, not what it is built with.
- **context** — 2-3 sentences. When the user lands here, what they came to do, where they can navigate next, and any prerequisites (auth, role, prior selection).
- **sectionDescriptions** — map keyed by section id. For each section name:
  - what the user sees (cards, table, form, list, chart)
  - where the data comes from (HTTP method + route, or "client state derived from X")
  - which columns / fields appear when the section is a table or form
  - which interactive elements live inside and what triggers them
- **onLoadDescription** — single paragraph. Trace the data fetching at mount:
  - which endpoints are called and in what order (sequential vs. parallel)
  - what query parameters are sent and where they come from (URL params, user preferences, defaults)
  - how each response populates the visible sections
  - what falls back to the empty / loading / error state
- **actionDescriptions** — map keyed by trigger label (exact button text or interaction name). Each value covers:
  - what user interaction fires the action
  - which endpoint is called (HTTP method + route) and what payload fields it sends
  - any client-side validation that gates the call
  - the success path (state change, navigation, toast, optimistic UI)
  - the error path (validation message, retry, revert)

## Using the live browser capture

When the Item JSON contains `observedSections`, `observedApiCalls`, `observedTitle`, or `landedH1`, those are **ground truth from a real Chromium that loaded this route**. The source-derived `sections` / `apiCalls` are what the static parser inferred; the `observed*` fields are what actually rendered and fired. Prefer observed reality over source guesses when they conflict.

Concretely:

- **`observedSections`** — structural regions the browser saw, with their heading text, visible text snippet (up to 400 chars), table columns + row count if it's a table, and the interactive elements inside (buttons, inputs, links with hrefs + placeholders). Use these to write accurate `sectionDescriptions`: name the actual buttons the user sees, the actual columns in tables, the actual placeholder copy in inputs.
- **`observedApiCalls`** — the XHR/fetch calls that fired during page load, with method + URL + HTTP status. Use these for `onLoadDescription` and to map `actionDescriptions` back to real endpoints when an action's `trigger` corresponds to a button text visible in `observedSections.elements`. If `observedApiCalls` includes a call not in the static `apiCalls` list, document it anyway — the parser missed it.
- **`observedTitle`** / **`landedH1`** — the page title and first heading. Often the most user-facing name for the page; favour these in `summary` over the technical component name.
- **`landedUrl`** — the URL the SPA actually ended up on. If this differs from `route`, the page redirected (often an auth bounce). Mention the redirect in `context`.
- **`captureNavStatus`** / **`captureAuthLikelyFailed`** — when these signal a failed load (4xx/5xx), do NOT make up content from the source. Say plainly that capture could not load the page (include the HTTP status) and keep `summary` / `context` minimal.

## Writing guidelines

- **User-perspective language.** "The user sees…", "When the user clicks…".
- **Refer to endpoints by their HTTP method + route**, not by the hook or client function name.
- **When `observedSections` shows a button**, use its exact text in `actionDescriptions` keys.
- **Name visible columns and form fields explicitly** when the section is a table or form.
- **Skip optional fields entirely** if there's nothing meaningful to add for them.
- **Be concise per map value** — 1-3 sentences each.
- The object is fed directly into the spec item record — your output IS the documentation.
