import { copyFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { ZodType } from "zod";
import { Resolver, extractReferences } from "./attachments.js";
import { listFiles, readRecord, warn, type MarkdownRecord } from "./collect.js";

export type { MarkdownRecord };

export type FilterOptions = {
    /** Also copy local files referenced by matching notes. Defaults to `false`. */
    copyAttachments?: boolean;
};

export type FilterResult = {
    /** Copied markdown files, relative to source and destination. */
    notes: string[];
    /** Copied attachments, relative to source and destination. */
    attachments: string[];
};

/**
 * Copies every `.md` file below `source` whose record matches `filter` to `destination`,
 * mirroring the folder structure. The destination is emptied first.
 */
export async function filterMarkdown(
    source: string,
    destination: string,
    filter: ZodType,
    options: FilterOptions = {},
): Promise<FilterResult> {
    const sourceDir = path.resolve(source);
    const destinationDir = path.resolve(destination);
    assertSeparate(sourceDir, destinationDir);

    // 1. Collect a record for every markdown file.
    const files = await listFiles(sourceDir);
    const records = await Promise.all(
        files
            .filter((file) => file.endsWith(".md"))
            .map((file) => readRecord(sourceDir, file)),
    );

    // 2. Keep the records that match the filter.
    const matching = records.filter(
        (record) => filter.safeParse(record).success,
    );
    const notes = matching.map((record) => record.path);

    const attachments = new Set<string>();
    if (options.copyAttachments) {
        const resolver = new Resolver(files);
        for (const record of matching) {
            for (const { target, warnIfMissing } of extractReferences(record)) {
                const resolved = resolver.resolve(target, record.path);
                if (resolved) {
                    if (!resolved.endsWith(".md")) attachments.add(resolved);
                } else if (warnIfMissing && looksLikeAttachment(target)) {
                    warn(record.path, `referenced file not found: ${target}`);
                }
            }
        }
    }

    await rm(destinationDir, { recursive: true, force: true });
    await mkdir(destinationDir, { recursive: true });

    const copied = [...notes, ...attachments];
    await Promise.all(
        copied.map(async (file) => {
            const target = path.join(destinationDir, file);
            await mkdir(path.dirname(target), { recursive: true });
            await copyFile(path.join(sourceDir, file), target);
        }),
    );

    return { notes, attachments: [...attachments].sort() };
}

/** Throws if emptying the destination could touch the source, or the output would be scanned again. */
function assertSeparate(source: string, destination: string): void {
    const within = (parent: string, child: string) => {
        const relative = path.relative(parent, child);
        return (
            relative !== ".." &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative)
        );
    };

    if (within(source, destination)) {
        throw new Error(
            source === destination
                ? `Destination must not be the source directory: ${destination}`
                : `Destination must not be inside the source directory: ${destination}`,
        );
    }
    if (within(destination, source)) {
        throw new Error(
            `Destination must not contain the source directory: ${destination}`,
        );
    }
}

/** Links without an extension usually point to (possibly not yet created) notes. */
function looksLikeAttachment(target: string): boolean {
    const extension = path.posix.extname(target);
    return extension !== "" && extension !== ".md";
}
