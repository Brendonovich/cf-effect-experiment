import { Effect, Ref } from "effect";

import * as AtomicFile from "./AtomicFile.ts";
import { ModuleState } from "./ModuleState.ts";

/** Reads the state file (missing means empty) and writes it atomically on every update. */
export const file = (
  path: string,
): Effect.Effect<ModuleState.Store, ModuleState.ModuleStateError> =>
  Effect.gen(function* () {
    const failure = (message: unknown) =>
      new ModuleState.ModuleStateError({
        path,
        message: message instanceof Error ? message.message : String(message),
      });
    const text = yield* Effect.try({ try: () => AtomicFile.readIfExists(path), catch: failure });
    const initial =
      text === undefined
        ? ModuleState.empty
        : yield* ModuleState.decode(text).pipe(
            Effect.mapError((error) =>
              failure(`Invalid ${ModuleState.FileName}: ${error.message}`),
            ),
          );
    const ref = yield* Ref.make(initial);
    return {
      get: Ref.get(ref),
      update: (f) =>
        Effect.gen(function* () {
          const next = f(yield* Ref.get(ref));
          const json = yield* ModuleState.encode(next).pipe(
            Effect.mapError((error) => failure(error.message)),
          );
          yield* Effect.try({
            try: () => AtomicFile.write(path, `${JSON.stringify(JSON.parse(json), null, 2)}\n`),
            catch: failure,
          });
          yield* Ref.set(ref, next);
          return next;
        }),
    };
  });

export * as ModuleStateFile from "./ModuleStateFile.ts";
