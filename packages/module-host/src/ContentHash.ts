import { Effect, Schema } from "effect";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export class ContentHashError extends Schema.TaggedError<ContentHashError>()("ContentHashError", {
  path: Schema.String,
  message: Schema.String,
}) {}

const ignored = (name: string) => name.startsWith(".") || name === "node_modules";

const files = (root: string, prefix = ""): Array<string> =>
  readdirSync(join(root, prefix), { withFileTypes: true })
    .filter((entry) => !ignored(entry.name))
    .flatMap((entry) => {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) return files(root, path);
      return entry.isFile() ? [path] : [];
    });

/**
 * Hex SHA-256 over every file in a module folder: sorted relative paths and their contents.
 * Dotfiles and `node_modules` are skipped.
 */
export const computeSync = (root: string): string => {
  const hash = createHash("sha256");
  for (const path of files(root).sort()) {
    const content = readFileSync(join(root, path));
    hash.update(`${path}\0${content.byteLength}\0`);
    hash.update(content);
  }
  return hash.digest("hex");
};

export const compute = (root: string) =>
  Effect.try({
    try: () => computeSync(root),
    catch: (error) =>
      new ContentHashError({
        path: root,
        message: error instanceof Error ? error.message : String(error),
      }),
  });

/** Hashes a string, for sources that have no folder (static modules). */
export const ofString = (value: string) => createHash("sha256").update(value).digest("hex");

/** The short form of a content hash used in versioned URLs. */
export const short = (hash: string) => hash.slice(0, 16);

export * as ContentHash from "./ContentHash.ts";
