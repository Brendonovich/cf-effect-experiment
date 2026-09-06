import { Config, Effect, FileSystem, Layer, Path } from "effect";
import { RpcTest } from "effect/unstable/rpc";

import {
  ClientRpcs,
  DirectoryFailure,
  FileFailure,
  FilesystemEngine,
  RuntimeRpcs,
} from "./Definition.ts";

export const make = Effect.fnUntraced(function* (writeEnabled = false) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return FilesystemEngine.of({
    resources: Layer.empty,
    rpcs: RuntimeRpcs.toLayer({
      FilesystemList: Effect.fnUntraced(
        function* (input) {
          if (input.path.trim() === "" || input.path.includes("\0"))
            return yield* new DirectoryFailure({ reason: "A valid folder path is required" });
          const entries = yield* fs.readDirectory(input.path);
          const selected = yield* Effect.forEach(
            entries.toSorted(),
            Effect.fnUntraced(function* (name) {
              const info = yield* fs.stat(path.join(input.path, name));
              return info.type === input.kind ? [name] : [];
            }),
            { concurrency: 16 },
          );
          return selected.flat();
        },
        Effect.mapError((error) =>
          error instanceof DirectoryFailure
            ? error
            : new DirectoryFailure({ reason: "Unable to list the directory" }),
        ),
      ),
      FilesystemReadText: Effect.fnUntraced(function* ({ path }) {
        if (path.trim() === "" || path.includes("\0"))
          return yield* new FileFailure({ reason: "A valid file path is required" });
        return yield* fs
          .readFileString(path, "utf8")
          .pipe(Effect.mapError(() => new FileFailure({ reason: "Unable to read the text file" })));
      }),
      FilesystemWriteText: Effect.fnUntraced(function* ({ path, text }) {
        if (!writeEnabled)
          return yield* new FileFailure({
            reason:
              "File writes are disabled. Set MACROGRAPH_ENABLE_FILE_WRITES=true on the runtime host to enable them.",
          });
        if (path.trim() === "" || path.includes("\0"))
          return yield* new FileFailure({ reason: "A valid file path is required" });
        yield* fs
          .writeFileString(path, text)
          .pipe(
            Effect.mapError(() => new FileFailure({ reason: "Unable to write the text file" })),
          );
      }),
    }),
    client: { state: Effect.succeed({}), rpcs: ClientRpcs.toLayer({}) },
  });
});

export const layer = FilesystemEngine.toLayer(() =>
  Effect.gen(function* () {
    const enabled = yield* Config.boolean("MACROGRAPH_ENABLE_FILE_WRITES").pipe(
      Config.withDefault(false),
    );
    return yield* make(enabled);
  }),
);
export const makeRuntimeClient = Effect.fnUntraced(function* (writeEnabled = false) {
  const engine = yield* make(writeEnabled);
  return yield* RpcTest.makeClient(RuntimeRpcs).pipe(Effect.provide(engine.rpcs));
});

export default layer;
