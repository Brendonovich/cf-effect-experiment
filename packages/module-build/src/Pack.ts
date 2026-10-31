/**
 * Packs a module package folder into the `.tgz` registries accept: package files at the archive
 * root (no `package/` prefix), regular files only, sorted with fixed metadata so the same folder
 * always produces the same bytes. Platform-neutral (Web Streams), no Node APIs.
 */
import { Manifest } from "@macrograph/module/Manifest";
import { Effect, Schema } from "effect";
import { packTar } from "modern-tar";

import type { Checks } from "./Checks.ts";

export class PackError extends Schema.TaggedError<PackError>()("ModulePackError", {
  message: Schema.String,
}) {}

const encoder = new TextEncoder();
const mtime = new Date(0);

const gzip = async (bytes: Uint8Array<ArrayBuffer>) =>
  new Uint8Array(
    await new Response(
      new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );

export const tarball = (
  files: ReadonlyArray<Checks.File>,
): Effect.Effect<Uint8Array<ArrayBuffer>, PackError> =>
  Effect.gen(function* () {
    const seen = new Set<string>();
    for (const file of files) {
      if (!Manifest.isPackagePath(file.path))
        return yield* new PackError({ message: `${file.path} is not a path inside the package` });
      if (seen.has(file.path))
        return yield* new PackError({ message: `${file.path} appears more than once` });
      seen.add(file.path);
    }
    const entries = [...files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((file) => {
        const body =
          typeof file.contents === "string" ? encoder.encode(file.contents) : file.contents;
        return {
          header: { name: file.path, size: body.byteLength, type: "file", mode: 0o644, mtime },
          body,
        } as const;
      });
    return yield* Effect.tryPromise({
      try: async () => gzip(await packTar(entries)),
      catch: (cause) =>
        new PackError({
          message: `Unable to create the tarball: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });
  });

export * as Pack from "./Pack.ts";
