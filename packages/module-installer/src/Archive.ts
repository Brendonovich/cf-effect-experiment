import { Manifest } from "@macrograph/module/Manifest";
import { Effect, Schema } from "effect";
import { unpackTar } from "modern-tar";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

/** The archive contains an entry that could escape the target folder or isn't a plain file. */
export class UnsafeArchive extends Schema.TaggedError<UnsafeArchive>()("UnsafeArchive", {
  entry: Schema.String,
  message: Schema.String,
}) {}

export class ArchiveError extends Schema.TaggedError<ArchiveError>()("ArchiveError", {
  message: Schema.String,
}) {}

export interface Entry {
  /** A forward-slash path inside the package, validated with `Manifest.isPackagePath`. */
  readonly path: string;
  /** File contents; absent for directories. */
  readonly data?: Uint8Array;
}

export interface Limits {
  readonly maxUnpackedBytes: number;
  readonly maxEntries: number;
}

export const defaultLimits: Limits = {
  maxUnpackedBytes: 256 * 1024 * 1024,
  maxEntries: 10_000,
};

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const normalizeName = (name: string) => {
  let path = name;
  while (path.startsWith("./")) path = path.slice(2);
  while (path.endsWith("/")) path = path.slice(0, -1);
  return path;
};

/**
 * Decompresses and parses a package `.tgz` in memory. Package files sit at the archive root
 * (`macrograph.json`, `server.cjs`, ...); a leading `./` is accepted. Only regular files and
 * directories are allowed, and every path must stay inside the package.
 */
export const read = (
  tgz: Uint8Array,
  limits: Limits = defaultLimits,
): Effect.Effect<ReadonlyArray<Entry>, UnsafeArchive | ArchiveError> =>
  Effect.gen(function* () {
    const tar = yield* Effect.try({
      try: () => gunzipSync(tgz, { maxOutputLength: limits.maxUnpackedBytes }),
      catch: (cause) => new ArchiveError({ message: `Could not decompress: ${describe(cause)}` }),
    });
    const raw = yield* Effect.tryPromise({
      try: () => unpackTar(tar, { strict: true }),
      catch: (cause) => new ArchiveError({ message: `Could not read tar: ${describe(cause)}` }),
    });
    if (raw.length > limits.maxEntries)
      return yield* new ArchiveError({ message: "Archive has too many entries" });

    const seen = new Set<string>();
    const entries: Array<Entry> = [];
    for (const { header, data } of raw) {
      const type = header.type ?? "file";
      if (type !== "file" && type !== "directory")
        return yield* new UnsafeArchive({
          entry: header.name,
          message: `Entries of type ${type} are not allowed`,
        });
      const path = normalizeName(header.name);
      if (type === "directory" && path === "") continue;
      if (path.includes("\0") || !Manifest.isPackagePath(path))
        return yield* new UnsafeArchive({
          entry: header.name,
          message: "Path escapes the package folder",
        });
      if (type === "file") {
        if (seen.has(path))
          return yield* new UnsafeArchive({ entry: header.name, message: "Duplicate entry" });
        seen.add(path);
        entries.push({ path, data: data ?? new Uint8Array() });
      } else entries.push({ path });
    }
    return entries;
  });

/** Writes entries into an empty folder, refusing to write anywhere outside it. */
export const extract = (
  entries: ReadonlyArray<Entry>,
  directory: string,
): Effect.Effect<void, UnsafeArchive | ArchiveError> =>
  Effect.gen(function* () {
    const root = resolve(directory);
    yield* Effect.tryPromise({
      try: () => mkdir(root, { recursive: true }),
      catch: (cause) => new ArchiveError({ message: describe(cause) }),
    });
    for (const entry of entries) {
      const target = resolve(join(root, ...entry.path.split("/")));
      const inside = relative(root, target);
      if (inside === "" || inside.startsWith(`..${sep}`) || inside === ".." || isAbsolute(inside))
        return yield* new UnsafeArchive({
          entry: entry.path,
          message: "Path escapes the package folder",
        });
      yield* Effect.tryPromise({
        try: async () => {
          if (entry.data === undefined) {
            await mkdir(target, { recursive: true });
            return;
          }
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, entry.data, { flag: "wx", mode: 0o644 });
        },
        catch: (cause) =>
          new ArchiveError({ message: `Could not write ${entry.path}: ${describe(cause)}` }),
      });
    }
  });

export * as Archive from "./Archive.ts";
