# md-filter

Copy the markdown files of a folder (e.g. an Obsidian vault) whose metadata matches a [Zod](https://zod.dev) schema, optionally together with the attachments they reference.

```sh
npm install md-filter zod
```

```ts
import { filterMarkdown } from "md-filter";
import { z } from "zod";

const { notes, attachments } = await filterMarkdown(
  "./vault",
  "./public",
  z.object({ frontmatter: z.object({ publish: z.literal(true) }) }),
  { copyAttachments: true },
);
```

## How it works

1. **Collect.** Every file ending in `.md` below `source` (dot-folders included, symlinks not followed) becomes a record:

   ```ts
   type MarkdownRecord = {
     path: string;                         // relative to source, "/"-separated: "notes/foo.md"
     modified: Date;                       // file modification time
     frontmatter: Record<string, unknown>; // parsed YAML, {} if absent or invalid
     content: string;                      // body without the frontmatter
   };
   ```

   Frontmatter is parsed as YAML 1.2, so unquoted dates like `date: 2024-01-01` stay strings (use `z.coerce.date()` if you need a `Date`). Invalid frontmatter is treated as `{}` and reported with `console.warn`.

2. **Filter.** A note matches if `filter.safeParse(record).success`. Any Zod schema works:

   ```ts
   z.object({
     path: z.string().refine((p) => !p.startsWith("templates/")),
     modified: z.date().min(new Date("2025-01-01")),
     frontmatter: z.object({ tags: z.array(z.string()).refine((t) => t.includes("blog")) }),
   });
   ```

3. **Copy.** `destination` is **emptied first**, then the matching notes are copied byte for byte, mirroring the folder structure. Links are not rewritten, as they resolve the same way in the destination.

   The function throws if the destination is the source, lies inside it, or contains it.

## Attachments

With `copyAttachments: true`, local non-markdown files referenced by matching notes are copied as well. References are:

- markdown images and links: `![alt](img/a.png)`, `[doc](files/spec%20v1.pdf)`
- wikilinks and embeds: `[[doc.pdf#page=2]]`, `![[image.png|300]]`
- every string value in the frontmatter, at any depth: `cover: image.jpg`, `banner: "[[image.jpg]]"`

References inside code spans and fenced code blocks and URLs with a scheme (`https:`, `mailto:`, …) are ignored.

Each reference is resolved like Obsidian does:

1. relative to the note's folder,
2. relative to the source root,
3. by file name (or path suffix) anywhere in the source; if several files match, the one sharing the most folders with the note wins, then the shortest path.

References that resolve to a `.md` file are links to other notes and are never copied; those notes are copied only if they match the filter themselves. Unresolved body references with a non-`.md` file extension are reported with `console.warn`. Unresolved frontmatter values are ignored silently, since most of them (`title: Hello`) aren't file references.

Note that every frontmatter string is a candidate: `status: done` copies a file named `done` if one exists.

## Development

```sh
npm test          # integration tests against test/fixtures/vault
npm run typecheck
npm run build
```

## License

MIT
