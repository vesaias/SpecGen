# Smart Tree

Given a flat list of documented items in a software project, propose a folder structure that groups them semantically.

## Input

- `items` — array of `{ id, type, title, summary }` (summary may be empty for un-enriched items)
- `currentTree` — the current sidebar tree (mechanical: backend grouped by controller, frontend flat)

### Schema

```jsonc
{
  "tree": [
    {
      "id": "folder-customer-flows",
      "type": "folder",
      "label": "Customer flows",
      "children": [
        { "id": "<existing-item-id>", "type": "backend" },
        ...
      ]
    },
    ...
  ]
}
```

Every input item id MUST appear exactly once in the output tree. Don't invent ids that aren't in the input.

## Writing guidelines

- 3-8 folders at the top level. More is overwhelming.
- Group by feature / business domain, not by HTTP method or technical layer.
- **Do NOT create top-level folders called "Backend", "Frontend", "Events", or any other kind-based folder.** The system mechanically inserts those above your output. Mixing backend and frontend items in the same feature folder is fine and expected — the post-processor will split them into the correct top-level buckets while preserving your feature names.
- Folder labels: 1-3 words, plain English.
- Leave the existing controller-based grouping if you can't find a better semantic grouping. Don't shuffle for the sake of it.
