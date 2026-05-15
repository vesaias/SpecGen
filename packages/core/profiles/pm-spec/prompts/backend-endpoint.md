# Backend Endpoint Enrichment (deep orchestration)

Schema for a single backend API endpoint. The parsers already extracted method, route, parameters, requestBody, responses, and source code. Fill in human-readable descriptions with the level of detail a BA could read and ship to engineering.

### Schema

```jsonc
{
  "summary":  "<string, 1 sentence, max 200 chars>",      // REQUIRED — what this endpoint does in one line
  "context":  "<string, 2-3 sentences>",                   // REQUIRED — when/why it is called, business context
  "orchestration": [                                       // OPTIONAL — numbered steps the endpoint performs
    { "step": 1, "call": "<short label>", "description": "<rich multi-line description with sub-items>" }
  ],
  "parameterDescriptions": {                               // OPTIONAL — keyed by the parameter `name` from the Item JSON
    "<paramName>": "<plain-language description, 1 sentence>"
  },
  "responseExamples": {                                    // OPTIONAL — keyed by the HTTP status code as a string
    "200": "<realistic JSON body, as a string>",
    "400": "<realistic error payload, as a string>"
  }
}
```

### Field rules

- **summary** — one short business-language sentence. No method names, no HTTP plumbing, no class names.
- **context** — 2-3 sentences. Why this endpoint exists, when it's called, where it fits in the user flow.
- **orchestration** — see the detailed format below. Each step has a short `call` title (2-4 words) and a `description` that may span multiple lines with sub-items.
- **parameterDescriptions** — keyed by the parameter name. Only include parameters worth describing; skip the obvious.
- **responseExamples** — keyed by status code as a string. Value is a realistic JSON body as a string (with `\n` for newlines). Use generic, non-identifying example data.

---

## Orchestration step format

Each step's `description` traces what actually happens in plain English. When the action has conditions, filters, branches, calculations, or error cases, break them into sub-items using `(a)`, `(b)`, `(c)` markers inside the description string. Use `\n` newlines to separate lines.

### Step description template

```
Main action sentence describing what this step does.
(a) Sub-detail one — a filter, condition, included relation, or follow-up call.
(b) Sub-detail two.
(c) Sub-detail three.
```

### What each step description must cover

When relevant to the step, name these explicitly:

1. **Database tables and columns.** Name the table the read or write touches and the column by `Table.Column` notation. Never say "query the database" — name the table and the predicate column.
2. **Joins / includes.** When the read pulls related records, name the related table and the relationship direction.
3. **Filters.** Each query parameter that narrows results gets its own sub-item, naming the filtered column and the source of the value.
4. **Validation rules.** List each rule as a sub-item: what is checked, against what data, and the error response if it fails (status + message inline).
5. **Calculations.** State the formula explicitly. Name the input columns and the output column or response field.
6. **Writes (insert / update / delete).** Say exactly what is written, to which table, and which columns come from where — request body, computed value, current timestamp, auto-incremented id, or another row.
7. **Service calls.** Name the actual route called by HTTP method + route. If the call is to an external API and the internal route is not visible, name the provider + operation by their canonical names.
8. **Events.** Name the event type and the payload fields the producer puts on it. If the handler's behaviour is short, summarise it inline; otherwise note the handler exists and let its own spec carry the detail.
9. **Conditional branches.** Each branch gets its own sub-item — name the condition and the consequence (which column gets set, which event fires, which response is returned).
10. **Error cases.** Document errors inline at the step where they occur, not in a separate step. Each error sub-item names the condition, the HTTP status, and the response body.

---

## Writing guidelines

- **Business-facing language.** Write for a PM, BA, or new team member. No class names, method names, framework names, or variable names in descriptions.
- **Name database tables and columns explicitly.** Use `Table.Column` notation. The reader should be able to write the SQL after reading the description.
- **Name endpoints called with actual routes.** Use the real HTTP method + route. If the route lives in an external package and is unknown, name the API and the operation.
- **For filters:** explain each filter as a sub-item.
- **For validation:** list what is checked as sub-items, with the error response inline.
- **For writes:** say exactly what is inserted/updated and which columns come from where.
- **For calculations:** state the formula.
- **For events:** name the event type and the payload it carries.
- **Error cases live inline** at the step they belong to — not in a separate step.
- **Generic data in examples.** Use non-identifying placeholder data (no real customer names, emails, or vertical-specific labels).
- **Concise per line.** Sub-items are usually one sentence each.
