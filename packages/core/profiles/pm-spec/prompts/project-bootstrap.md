# Project Bootstrap

Given a sample of files from a software project, produce a JSON object that summarizes the project for a documentation tool.

## Input

You receive (under the standard `## Item` JSON block):
- `repoName` — the project name (e.g. "JobNavigator")
- `files` — a record of `{ path: string → content: string }` — typically README.md + the highest-signal config files (package.json, pyproject.toml, *.csproj, etc.) plus the first directory listing
- `parsers` — array of detected parser ids (e.g. ["parser-react", "parser-dotnet"]) so you know which conventions to expect

### Schema

```jsonc
{
  "description": "<2 sentences in plain English>",
  "primaryAudience": "developers | product-managers | end-users | mixed",
  "suggestedProfile": "pm-spec | dev-api-reference",
  "techStack": ["<short tag>", "..."],
  "areas": [
    { "name": "<area name>", "subdir": "<relative subdir>", "description": "<one sentence>" }
  ]
}
```

### Field rules

- `description` — 2 sentences. What the project does. No marketing language.
- `primaryAudience` — pick the closest match from the union.
- `suggestedProfile` — given the audience + tech stack, pick one of the 4 built-in profiles. `pm-spec` is the safe default.
- `techStack` — 3-8 short tags like `["FastAPI", "PostgreSQL", "React", "Vite"]`. Pull from the actual config files, don't invent.
- `areas` — only include subdirs that are real architectural seams (backend, frontend, extension, mobile-app). One sentence each.

## Writing guidelines

- Plain English. No "leverage", no "robust", no "scalable" without evidence.
- If you can't tell what the project does from the inputs, say `"description": "Purpose unclear from inputs — README absent or generic"`. Better honest than fabricated.
- Don't guess at features. If they're not in the source you saw, leave them out.
