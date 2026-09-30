import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { z } from "zod";
import { filterMarkdown, type MarkdownRecord } from "../src/index.js";

const vault = fileURLToPath(new URL("./fixtures/vault", import.meta.url));
const published = z.object({ frontmatter: z.object({ publish: z.literal(true) }) });

let tmp: string;
let dest: string;
let warn: MockInstance<typeof console.warn>;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "md-filter-"));
  dest = path.join(tmp, "out");
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  warn.mockRestore();
  await rm(tmp, { recursive: true, force: true });
});

async function tree(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

function warnings(): string[] {
  return warn.mock.calls.map((call) => String(call[0]));
}

describe("filtering", () => {
  it("copies only matching notes, mirroring the folder structure", async () => {
    const result = await filterMarkdown(vault, dest, published);

    const notes = [".trash/old.md", "notes/nested.md", "published.md"];
    expect(result).toEqual({ notes, attachments: [] });
    expect(await tree(dest)).toEqual(notes);
  });

  it("copies files byte for byte", async () => {
    await filterMarkdown(vault, dest, published, { copyAttachments: true });

    for (const file of ["published.md", "cover.jpg", "docs/spec v1.pdf"]) {
      expect(await readFile(path.join(dest, file))).toEqual(await readFile(path.join(vault, file)));
    }
  });

  it("can filter on path, content and modification time", async () => {
    const inNotes = z.object({ path: z.string().startsWith("notes/") });
    expect((await filterMarkdown(vault, dest, inNotes)).notes).toEqual(["notes/nested.md"]);

    const mentionsDeleted = z.object({ content: z.string().includes("Deleted") });
    expect((await filterMarkdown(vault, dest, mentionsDeleted)).notes).toEqual([".trash/old.md"]);

    const future = z.object({ modified: z.date().min(new Date(Date.now() + 86_400_000)) });
    expect((await filterMarkdown(vault, dest, future)).notes).toEqual([]);
  });

  it("passes a record with path, modified, frontmatter and content to the schema", async () => {
    const records: MarkdownRecord[] = [];
    const spy = z.custom<MarkdownRecord>((value) => {
      records.push(value as MarkdownRecord);
      return false;
    });

    await filterMarkdown(vault, dest, spy);

    expect(records.map((record) => record.path).sort()).toEqual([
      ".trash/old.md",
      "broken.md",
      "draft.md",
      "no-frontmatter.md",
      "notes/nested.md",
      "published.md",
    ]);

    const record = records.find((r) => r.path === "published.md")!;
    expect(Object.keys(record).sort()).toEqual(["content", "frontmatter", "modified", "path"]);
    expect(record.modified).toBeInstanceOf(Date);
    expect(record.frontmatter).toMatchObject({ publish: true, date: "2024-01-01" });
    expect(record.content.startsWith("\n# Published")).toBe(true);

    const plain = records.find((r) => r.path === "no-frontmatter.md")!;
    expect(plain.frontmatter).toEqual({});
    expect(plain.content).toBe("# No frontmatter\n\n![[embed.png]]\n");
  });

  it("treats invalid frontmatter as empty and warns without aborting", async () => {
    const records: MarkdownRecord[] = [];
    await filterMarkdown(
      vault,
      dest,
      z.custom((value) => (records.push(value as MarkdownRecord), false)),
    );

    expect(records.find((r) => r.path === "broken.md")!.frontmatter).toEqual({});
    expect(warnings()).toEqual([expect.stringMatching(/^md-filter: broken\.md: invalid frontmatter/)]);
  });
});

describe("attachments", () => {
  it("copies files referenced by links, embeds and frontmatter of matching notes", async () => {
    const result = await filterMarkdown(vault, dest, published, { copyAttachments: true });

    const attachments = [
      "attachments/doc.pdf", // [[doc.pdf#page=2]] via file name lookup
      "attachments/embed.png", // ![[embed.png|300]]
      "cover.jpg", // cover: "cover.jpg"
      "docs/spec v1.pdf", // [The spec](docs/spec%20v1.pdf "Specification")
      "done", // status: done
      "here.jpg", // another-attachment: here.jpg
      "images/inline.png", // ![inline](images/inline.png)
      "nested/deep.png", // gallery: [nested/deep.png]
      "notes/shared.png", // ![[shared.png]] from notes/nested.md, closest match wins
      "wiki-fm.jpg", // also-this: "[[wiki-fm.jpg]]"
    ];
    expect(result.attachments).toEqual(attachments);
    expect(await tree(dest)).toEqual([...result.notes, ...attachments].sort());
  });

  it("does not copy attachments of non-matching notes or references inside code", async () => {
    await filterMarkdown(vault, dest, published, { copyAttachments: true });

    const copied = await tree(dest);
    for (const file of ["draft-only.png", "broken-only.png", "code.png", "fenced.png", "draft.md"]) {
      expect(copied).not.toContain(file);
    }
  });

  it("warns about missing attachments but not about links to missing notes", async () => {
    await filterMarkdown(vault, dest, published, { copyAttachments: true });

    expect(warnings()).toContain("md-filter: published.md: referenced file not found: missing.png");
    expect(warnings().filter((w) => w.includes("not found"))).toHaveLength(1);
  });

  it("prefers a path relative to the note over a file name match", async () => {
    const source = path.join(tmp, "vault");
    await mkdir(path.join(source, "a"), { recursive: true });
    await mkdir(path.join(source, "img"), { recursive: true });
    await writeFile(path.join(source, "a/note.md"), "![](../img/x.png)\n![[x.png]]\n");
    await writeFile(path.join(source, "img/x.png"), "img");
    await writeFile(path.join(source, "x.png"), "root");

    const result = await filterMarkdown(source, dest, z.any(), { copyAttachments: true });
    expect(result.attachments).toEqual(["img/x.png", "x.png"]);
  });
});

describe("destination", () => {
  it("empties the destination before copying", async () => {
    await mkdir(dest, { recursive: true });
    await writeFile(path.join(dest, "stale.md"), "old");

    await filterMarkdown(vault, dest, published);
    expect(await tree(dest)).not.toContain("stale.md");
  });

  it.each([
    ["is the source", (source: string) => source, /must not be the source/],
    ["is inside the source", (source: string) => path.join(source, "out"), /must not be inside/],
    ["contains the source", (source: string) => path.dirname(source), /must not contain/],
  ])("throws without deleting anything if the destination %s", async (_, toDest, message) => {
    const source = path.join(tmp, "vault");
    await cp(vault, source, { recursive: true });
    const before = await tree(source);

    await expect(filterMarkdown(source, toDest(source), published)).rejects.toThrow(message);
    expect(await tree(source)).toEqual(before);
  });
});
