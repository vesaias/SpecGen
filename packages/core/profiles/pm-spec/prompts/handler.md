# Handler Enrichment

Schema for a single event handler. The parsers already extracted the handler name, the triggering event, services called, DB operations, and events raised. Describe what the handler does in business language — focus on what CHANGES in the system, not what the code looks like.

### Schema

```jsonc
{
  "description": "<string, 1-2 sentences, max ~500 chars>",   // REQUIRED — what the handler does in plain English
  "listensTo": ["<eventName>", "<eventName>"],                // OPTIONAL — array of event names this handler subscribes to
  "logic": "<string>"                                         // OPTIONAL — detailed step-by-step business logic (numbered list as plain text)
}
```

### Field rules

- **description** — 1-2 sentences summarizing what the handler does, viewed from the system's behaviour. State what CHANGES (which records, which downstream services, which user-visible effects) when this handler runs.
- **listensTo** — array of event names this handler subscribes to. Usually just one.
- **logic** — numbered list as plain text in the handler's order of operations. Each step starts with a short title and describes what changes in the system. Use `\n` newlines between steps in the JSON string.

## Logic step format

Each step traces what actually happens, in order. When the action has conditions, filters, or branches, break them into sub-items using `(a)`, `(b)`, `(c)` markers inside the step.

```
1. Short step title — main action sentence describing what this step does.
(a) Sub-detail one — a filter, condition, or follow-up action.
(b) Sub-detail two.

2. Short step title — next action.
(a) ...
```

When relevant, name these explicitly inside each step:

- **Database reads.** Name the table and the predicate column in `Table.Column` notation. State which related records are pulled along.
- **Filters / conditions.** Each filter or guard becomes a sub-item naming the column and the source of the comparison value.
- **Calculations.** State the formula with input columns and output column.
- **Database writes (insert / update / delete).** Say exactly which table, which columns are written, and where each value comes from (event payload field, computed value, current timestamp, another row).
- **Service calls.** Name the actual HTTP method + route. For external services, name the provider + operation.
- **Events raised.** Name the event type and the payload fields the handler attaches.
- **Branches.** Each branch is a sub-item: the condition and the consequence (which write happens, which event fires, which call is skipped).
- **Failure paths.** When a downstream call fails, what does the handler do — retry, dead-letter, swallow, raise a compensating event? Document it inline at the step where the failure can occur.

## Writing guidelines

- **Handlers are behavioural specs.** Focus on what CHANGES in the system, not what the code looks like.
- **Name DB tables and columns** in `Table.Column` notation. The reader should be able to write the SQL after reading the description.
- **Name endpoints called** by HTTP method + route, not by client class name.
- **Reference the triggering event by name**, not by class path.
- **Side effects are the point.** Every step should either change persistent state, call out to another system, or guard one of those — narration without a side effect is usually a code-detail leak.
- **Skip optional fields entirely** if there's nothing meaningful to add.
- The object is fed directly into the spec item record.
