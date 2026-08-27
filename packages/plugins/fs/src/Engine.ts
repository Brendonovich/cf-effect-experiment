import { Effect, FileSystem, Layer, Path } from "effect";
import { RpcTest } from "effect/unstable/rpc";

import { ClientRpcs, DirectoryFailure, FilesystemEngine, RuntimeRpcs } from "./Definition.ts";

export const make = Effect.fnUntraced(function* () {
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
    }),
    client: { state: Effect.succeed({}), rpcs: ClientRpcs.toLayer({}) },
  });
});

export const layer = Layer.effect(FilesystemEngine)(make());
export const makeRuntimeClient = Effect.fnUntraced(function* () {
  const engine = yield* make();
  return yield* RpcTest.makeClient(RuntimeRpcs).pipe(Effect.provide(engine.rpcs));
});

export default layer;
