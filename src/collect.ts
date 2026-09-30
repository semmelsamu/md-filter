import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

export type MarkdownRecord = {
    /** Path relative to the source directory, using `/` separators. */
    path: string;
    /** Last modification time of the file. */
    modified: Date;
    /** Parsed YAML frontmatter, `{}` if absent or invalid. */
    frontmatter: Record<string, unknown>;
    /** File body without the frontmatter block. */
    content: string;
};

/**
 * Lists every file below `root` as a relative POSIX path.
 * Dot-folders are included, symlinks are not followed.
 */
export async function listFiles(root: string): Promise<string[]> {
    const files: string[] = [];

    async function walk(relativeDir: string): Promise<void> {
        const entries = await readdir(path.join(root, relativeDir), {
            withFileTypes: true,
        });
        for (const entry of entries) {
            const relative = relativeDir
                ? `${relativeDir}/${entry.name}`
                : entry.name;
            if (entry.isDirectory()) await walk(relative);
            else if (entry.isFile()) files.push(relative);
        }
    }

    await walk("");
    return files.sort();
}

const FRONTMATTER =
    /^---[ \t]*\r?\n([\s\S]*?)\r?\n?^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m;

/** Splits a markdown file into frontmatter and body. Invalid frontmatter yields `{}` and a warning. */
export function parseMarkdown(
    source: string,
    filePath: string,
): Pick<MarkdownRecord, "frontmatter" | "content"> {
    const text = source.startsWith("﻿") ? source.slice(1) : source;

    if (!/^---[ \t]*\r?\n/.test(text))
        return { frontmatter: {}, content: text };

    const match = FRONTMATTER.exec(text);
    if (!match || match.index !== 0) {
        warn(filePath, "frontmatter is not closed, treating it as empty");
        return { frontmatter: {}, content: text };
    }

    const content = text.slice(match[0].length);
    try {
        const data: unknown = parse(match[1] ?? "");
        if (data == null) return { frontmatter: {}, content };
        if (typeof data !== "object" || Array.isArray(data)) {
            warn(
                filePath,
                "frontmatter is not a key/value mapping, treating it as empty",
            );
            return { frontmatter: {}, content };
        }
        return { frontmatter: data as Record<string, unknown>, content };
    } catch (error) {
        const reason =
            error instanceof Error
                ? error.message.split("\n")[0]
                : String(error);
        warn(filePath, `invalid frontmatter, treating it as empty (${reason})`);
        return { frontmatter: {}, content };
    }
}

export async function readRecord(
    root: string,
    relativePath: string,
): Promise<MarkdownRecord> {
    const absolute = path.join(root, relativePath);
    const [source, stats] = await Promise.all([
        readFile(absolute, "utf8"),
        stat(absolute),
    ]);
    return {
        path: relativePath,
        modified: stats.mtime,
        ...parseMarkdown(source, relativePath),
    };
}

export function warn(filePath: string, message: string): void {
    console.warn(`md-filter: ${filePath}: ${message}`);
}
