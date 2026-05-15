# Domain Event Enrichment

Schema for a single domain event. The parsers already extracted the event name, payload fields, triggers, and the handler name. Describe the event's purpose, what it carries, and who consumes it — in business language.

Events are **data contracts** — what is published, when, and who cares. NO handler behaviour here (that belongs in the handler's own spec).

### Schema

```jsonc
{
  "summary": "<string, 1 sentence, max 200 chars>",        // REQUIRED — what this event represents
  "context": "<string, 1-2 sentences>",                    // OPTIONAL — when it is raised, downstream effects at a high level
  "payloadDescription": "<string>",                        // OPTIONAL — what the payload carries, in plain English
  "triggerDescription": "<string>",                        // OPTIONAL — which user action / system condition raises it
  "handlerDescription": "<string>"                         // OPTIONAL — one-line summary of what the handler does (full details live on the handler spec)
}
```

### Field rules

- **summary** — one sentence in past-tense business language ("raised when X happened" / "fires after Y"). State the business meaning, not the implementation.
- **context** — 1-2 sentences. The trigger condition and what fires downstream at a high level. Reference the producing endpoint by HTTP method + route, never by class name.
- **payloadDescription** — one paragraph. For each meaningful payload field, name it and say what it represents in business terms. Note which fields are required vs. optional, and which carry foreign-key-style references to other entities.
- **triggerDescription** — one or two sentences. The action that raises this event: which endpoint, which user-facing operation, or which scheduled job. If the event is raised conditionally, name the condition.
- **handlerDescription** — one sentence on what the handler does at a high level. Detailed handler logic belongs in the handler's own spec, not here.

## Writing guidelines

- **No business logic.** No handler steps. No conditional branches. Events are contracts, not behaviour.
- **Plain business language.** No class names, no namespace paths.
- **Name payload fields explicitly** by their property name when describing what the event carries.
- **Tense matters.** Events represent something that already happened — past tense. Avoid imperative voice ("creates X") in favour of past ("X was created").
- **Skip optional fields entirely** if there's nothing meaningful to add.
- The object is fed directly into the spec item record.
