import path from "node:path";
import type { MarkdownRecord } from "./collect.js";

export type Reference = {
    /** The link target, already stripped of aliases, headings and block ids. */
    target: string;
    /** Whether an unresolved reference should produce a warning. */
    warnIfMissing: boolean;
};

const WIKILINK = /!?\[\[([^\]\n]+)\]\]/g;
// `[text](target "title")` / `![alt](<target with spaces>)`, allowing one level of parentheses in the target.
const MARKDOWN_LINK =
    /!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|(?:[^()\s]|\([^()\s]*\))+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Collects all references from a note's body and frontmatter. */
export function extractReferences(record: MarkdownRecord): Reference[] {
    const references: Reference[] = [];
    const body = stripCode(record.content);

    for (const [, inner] of body.matchAll(WIKILINK)) {
        const target = cleanWikilink(inner!);
        if (target) references.push({ target, warnIfMissing: true });
    }

    for (const [, raw] of body.matchAll(MARKDOWN_LINK)) {
        let target = raw!.startsWith("<") ? raw!.slice(1, -1) : raw!;
        if (URL_SCHEME.test(target)) continue;
        target = safeDecode(target.split("#")[0]!.split("?")[0]!);
        if (target) references.push({ target, warnIfMissing: true });
    }

    for (const value of frontmatterStrings(record.frontmatter)) {
        const wikilink = /^!?\[\[([^\]]+)\]\]$/.exec(value.trim());
        const target = wikilink ? cleanWikilink(wikilink[1]!) : value;
        if (target) references.push({ target, warnIfMissing: false });
    }

    return references;
}

/** Removes fenced code blocks and inline code so that links inside them are ignored. */
function stripCode(markdown: string): string {
    return markdown
        .replace(
            /^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1\2[`~]*[ \t]*$|(?![\s\S]))/gm,
            "",
        )
        .replace(/(`+)[^`\n][\s\S]*?\1/g, "");
}

function cleanWikilink(inner: string): string {
    return inner.split("|")[0]!.split("#")[0]!.split("^")[0]!.trim();
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function* frontmatterStrings(value: unknown): Generator<string> {
    if (typeof value === "string") {
        if (value) yield value;
    } else if (Array.isArray(value)) {
        for (const item of value) yield* frontmatterStrings(item);
    } else if (value && typeof value === "object") {
        for (const item of Object.values(value))
            yield* frontmatterStrings(item);
    }
}

/** Resolves link targets against the set of files in the vault, the way Obsidian does. */
export class Resolver {
    private readonly files: Set<string>;
    private readonly byName = new Map<string, string[]>();

    constructor(files: Iterable<string>) {
        this.files = new Set(files);
        for (const file of this.files) {
            const name = path.posix.basename(file);
            const list = this.byName.get(name);
            if (list) list.push(file);
            else this.byName.set(name, [file]);
        }
    }

    /** Returns the vault-relative path the target points to, or `undefined` if nothing matches. */
    resolve(target: string, fromNote: string): string | undefined {
        const candidates = path.posix.extname(target)
            ? [target]
            : [target, `${target}.md`];
        const noteDir = path.posix.dirname(fromNote);

        for (const candidate of candidates) {
            // 1. relative to the note, 2. relative to the vault root
            for (const base of [noteDir, "."]) {
                const joined = path.posix.normalize(
                    path.posix.join(base, candidate.replace(/^\/+/, "")),
                );
                if (this.files.has(joined)) return joined;
            }

            // 3. by file name (or path suffix) anywhere in the vault
            const suffix = candidate.replace(/^(\.\/)+|^\/+/, "");
            const matches = (
                this.byName.get(path.posix.basename(suffix)) ?? []
            ).filter((file) => file === suffix || file.endsWith(`/${suffix}`));
            if (matches.length) return closest(matches, noteDir);
        }

        return undefined;
    }
}

/** Picks the file that shares the most parent folders with the note, then the shortest path. */
function closest(files: string[], noteDir: string): string {
    const noteSegments = noteDir === "." ? [] : noteDir.split("/");
    const shared = (file: string) => {
        const segments = path.posix.dirname(file).split("/");
        let count = 0;
        while (
            count < noteSegments.length &&
            segments[count] === noteSegments[count]
        )
            count++;
        return count;
    };

    return [...files].sort(
        (a, b) =>
            shared(b) - shared(a) || a.length - b.length || a.localeCompare(b),
    )[0]!;
}
