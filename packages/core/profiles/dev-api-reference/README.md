# dev-api-reference

Profile for developer-facing API documentation. Pairs with `full-tree-spec`
to produce technical reference for integrators.

## Audience

Developers consuming or extending the API. Assumes familiarity with HTTP,
REST conventions, and JSON.

## Style

- Terse; no marketing language.
- Always include the HTTP method + route + content-type.
- Type-precise: name primitive types (`int32`, `string`, `boolean`, `ISO 8601`).
- Provide a curl example per endpoint.
- Document error response shapes alongside success responses.
- Use code blocks for request/response payloads.

## Item types covered

- `backend-endpoint` — full request/response/auth/errors documentation
- `frontend-page` — high-level routing + state notes (lighter than PM profile)
- `domain-event` — event payload schema + producer/consumer table
- `handler` — handler logic from a developer angle

## Switching to this profile

In the project's AI tab, pick `Developer API Reference`. Re-run parse to
re-enrich existing items with developer-audience prompts.
