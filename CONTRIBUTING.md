# Contributing

Thanks for thinking about contributing! This is a personal project but I welcome any help. No formal process — just open a PR and we'll sort it out.

## Getting started

```bash
git clone https://github.com/vesaias/specgen.git
cd specgen
cp .env.example .env
# Optional: add ANTHROPIC_API_KEY / OPENAI_API_KEY, or set them in the UI later

pnpm install
pnpm dev
# API on http://127.0.0.1:6101 — webapp on http://127.0.0.1:6100 (HMR)
```

Or run the production-style container:

```bash
docker compose up -d --build
# Everything at http://127.0.0.1:6101
```

**Server** uses `tsx watch` in dev — code changes restart Express automatically. **Webapp** uses Vite HMR. If you change `packages/core`, run `pnpm --filter @specgen/core build` so the compiled `.d.ts` refreshes for the server (it imports the built dist).

Run tests + typecheck before opening a PR:

```bash
pnpm -w run typecheck
pnpm -w run test
```

## Easy things to contribute

### Add a new language parser

Most language stacks have a rule-based ATS-style parser pattern. Look at `packages/parser-python/` or `packages/parser-react/` for the shape.

A parser is a `ParserPlugin` with two methods:

```ts
export const myParser: ParserPlugin = {
  id: "mylang",
  detect: async ({ fs, rootDir }) => {
    // Return { confidence: 0..1, subDirs: string[] }
  },
  parse: async (input) => {
    // Return { endpoints, pages, events, warnings }
  },
};
```

Steps:

1. New package under `packages/parser-mylang/` — copy `packages/parser-python/` as a starting point.
2. Implement `detect` to recognise your language by file extensions or marker files (`requirements.txt`, `Cargo.toml`, `go.mod`, etc.).
3. Implement `parse` to return one `BackendSpec` per route handler, one `EventSpec` per event class, etc. — see `packages/core/src/parser/types.ts` for the full shape.
4. Register the parser in `packages/server/src/serve.ts` via `parserRegistry.register(subdirAwarePlugin(myParser))`.
5. Test against a small real-world repo. The LLM parser is a useful baseline to compare against — `packages/parser-llm/` produces the same `ParseResult` shape by AI extraction.

### Add a profile

A profile is a documentation voice. Drop a folder in `packages/core/profiles/`:

```
packages/core/profiles/your-profile/
├── profile.yaml                  # metadata + ai defaults + supports_item_types
├── README.md                     # what this profile produces + when to pick it
└── prompts/
    ├── backend-endpoint.md
    ├── frontend-page.md
    ├── domain-event.md
    └── handler.md
```

Profiles are auto-discovered at startup. Copy `pm-spec/` as a starting point and rewrite the prompts to your audience. The shipped-profiles smoke test will pick up your profile automatically — just add its id to `packages/core/tests/profile/shipped-profiles.smoke.test.ts`.

### Add a push connector

Outbound push targets live under `packages/connector-*/`. Existing ones: `git-docs` (commits to a target repo's branch), `confluence` (REST + ADF). To add Notion / GitBook / Read the Docs / etc.:

1. New package under `packages/connector-yourtarget/`.
2. Export a service class with `push(spec, options) -> PushResult`.
3. Add a `GeneratorPlugin` (e.g. `yourtarget-push.ts`) in `packages/core/src/generator/builtins/` that wraps the service.
4. Register the generator in `serve.ts`. Add a token shape to `packages/server/src/services/TokenStore.ts` if it needs auth.
5. Wire a settings tab in `packages/webapp/src/routes/settings/` for credential entry.

### Other good contributions

- Fix a bug you hit
- Add a new AI provider to `packages/core/src/ai/`
- Improve a parser's coverage on edge cases
- UI/UX polish
- Documentation

## How to contribute

1. Fork the repo
2. Make your change
3. Open a PR — include a short description and a screenshot if it's a UI change

## Architecture invariants (don't break these)

A few load-bearing rules that keep the codebase coherent:

1. **Generators never delete spec items silently.** `mergeSpec` preserves human + AI edits across re-parses. If your generator needs to remove items, it should be opt-in (e.g. behind `force=true`).
2. **Parsers don't write the spec.** They produce `ParseResult` only — generators decide what to do with it.
3. **AI runs use the project's selected profile.** Don't hard-code `"pm-spec"` — read `project.ai.profileId`.
4. **Item ids are stable.** Backend ids derive from `${method}-${route}`; frontend ids from `page-${page}`. Changing the derivation breaks every existing project's spec.
5. **The webapp's `useBlocks` hook prefers `item.blocks` over the default-blocks builder.** If your generator updates structured fields and wants the renderer to re-derive blocks, only `delete item.blocks` on explicit force runs — automatic drift-driven runs preserve hand-edits.
6. **No same-origin bypass.** State-changing HTTP routes go through `requireSameOrigin`.

## Stack

- Backend: Node 22+ / Express / `node:sqlite` / p-queue / Zod
- Frontend: React 18 / Tailwind / Vite / Tiptap / dnd-kit
- AI: Anthropic SDK / OpenAI SDK / Claude Code CLI
- Capture: Playwright
- Infrastructure: Docker Compose, pnpm workspace

## Questions

Open an issue or discussion — happy to help.
