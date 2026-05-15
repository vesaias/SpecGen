# pm-spec

Profile for product-manager-facing specifications. Generates business-readable
docs for backend endpoints, frontend pages, domain events, and event handlers.

Pair with: `dotnet` + `react` parsers, `full-tree-spec` generator.

To customise for your team: create `<project>/.specgen/profiles/pm-spec/` and
override any prompt file. See the SpecGen profile docs for inheritance rules
(file replacement, no merging).

## Item types supported

- `backend-endpoint` — REST endpoints with request/response/business logic
- `frontend-page` — UI pages with sections, navigation, on-load/on-action behaviour
- `domain-event` — domain events as data contracts (no business logic)
- `handler` — event handlers with description, listens-to, handler logic

## Generators

- `full-tree-spec` — multi-page wiki for a whole repository
- `single-page-spec` — selective files only

## AI defaults

- Model: `claude-haiku-4-5`
- Temperature: `0.2`
- Concurrency: `3`
- Output language: `en`

Override any of these per project in the dashboard's AI settings.
