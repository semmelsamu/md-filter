# md-filter

Copies the markdown files of a folder, such as an Obsidian vault, whose metadata matches a Zod schema, optionally together with the attachments they reference.

## Installation

```sh
npm install md-filter zod
```

## Usage

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

Relative paths are resolved against the current working directory. **Caution:** The destination is emptied on every run.

Every `.md` file in the source directory is scanned and then copied if `filter.safeParse(record).success`:

```ts
type MarkdownRecord = {
    path: string; // relative to source, "/"-separated: "notes/foo.md"
    modified: Date; // file modification time
    frontmatter: Record<string, unknown>; // parsed YAML, {} if absent or invalid
    content: string; // body without the frontmatter
};
```

With `copyAttachments: true`, local non-markdown files referenced by matching notes are copied too:

- Markdown images and links: `![alt](img/a.png)`, `[doc](files/spec%20v1.pdf)`
- Wikilinks and embeds: `[[doc.pdf#page=2]]`, `![[image.png|300]]`
- Every string value in the frontmatter: `cover: image.jpg`, `banner: "[[image.jpg]]"`

References are resolved like in Obsidian, meaning by filename anywhere in the vault (shortest path).

## Development

```sh
npm install           # also builds dist/
npm test              # integration tests against test/fixtures/vault
npm run typecheck
npm run build
```

Formatting uses Prettier:

```sh
npm run format        # format all files
npm run format:check  # check without writing
```

To release, bump the version (this commits and tags), push, and publish. Publishing runs the typecheck and tests first:

```sh
npm version patch     # or minor / major
git push --follow-tags
npm publish
```

## License

MIT, see [LICENSE](LICENSE).
