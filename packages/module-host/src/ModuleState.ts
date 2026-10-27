import { ModuleId } from "@macrograph/module/ModuleId";
import { Effect, Option, Ref, Schema } from "effect";

import * as AtomicFile from "./AtomicFile.ts";

/**
 * `<dataDir>/modules/state.json`: which modules are enabled and the dev links.
 *
 * Install records, registries and acknowledgements belong to the installer
 * (`@macrograph/module-installer`), which keeps them in its own file next to this one so the two
 * never race on writes.
 */
export const FileName = "state.json";

export const ModuleSettings = Schema.Struct({ enabled: Schema.Boolean });
export type ModuleSettings = typeof ModuleSettings.Type;

export const Link = Schema.Struct({ path: Schema.String });
export type Link = typeof Link.Type;

export const Model = Schema.Struct({
  version: Schema.Literal(1),
  modules: Schema.Record(Schema.String, ModuleSettings),
  links: Schema.Record(Schema.String, Link),
});
export type Model = typeof Model.Type;

export const empty: Model = { version: 1, modules: {}, links: {} };

export class ModuleStateError extends Schema.TaggedError<ModuleStateError>()("ModuleStateError", {
  path: Schema.String,
  message: Schema.String,
}) {}

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Model));
const encode = Schema.encodeEffect(Schema.fromJsonString(Model));

export const isEnabled = (state: Model, id: ModuleId.Id) => state.modules[id]?.enabled ?? true;

export const setEnabled = (state: Model, id: ModuleId.Id, enabled: boolean): Model => ({
  ...state,
  modules: { ...state.modules, [id]: { enabled } },
});

export const links = (state: Model): ReadonlyMap<ModuleId.Id, string> =>
  new Map(
    Object.entries(state.links).flatMap(([key, link]) =>
      Option.match(ModuleId.parse(key), {
        onNone: () => [],
        onSome: (id) => [[id, link.path] as const],
      }),
    ),
  );

export const setLink = (state: Model, id: ModuleId.Id, path: string | undefined): Model => {
  const { [id]: _previous, ...rest } = state.links;
  return { ...state, links: path === undefined ? rest : { ...rest, [id]: { path } } };
};

export interface Store {
  readonly get: Effect.Effect<Model>;
  readonly update: (f: (state: Model) => Model) => Effect.Effect<Model, ModuleStateError>;
}

/** An in-memory store, for hosts without a data directory. */
export const memory = (initial: Model = empty): Effect.Effect<Store> =>
  Effect.map(Ref.make(initial), (ref) => ({
    get: Ref.get(ref),
    update: (f) => Ref.updateAndGet(ref, f),
  }));

/** Reads the state file (missing means empty) and writes it atomically on every update. */
export const file = (path: string): Effect.Effect<Store, ModuleStateError> =>
  Effect.gen(function* () {
    const failure = (message: unknown) =>
      new ModuleStateError({
        path,
        message: message instanceof Error ? message.message : String(message),
      });
    const text = yield* Effect.try({ try: () => AtomicFile.readIfExists(path), catch: failure });
    const initial =
      text === undefined
        ? empty
        : yield* decode(text).pipe(
            Effect.mapError((error) => failure(`Invalid ${FileName}: ${error.message}`)),
          );
    const ref = yield* Ref.make(initial);
    return {
      get: Ref.get(ref),
      update: (f) =>
        Effect.gen(function* () {
          const next = f(yield* Ref.get(ref));
          const json = yield* encode(next).pipe(Effect.mapError((error) => failure(error.message)));
          yield* Effect.try({
            try: () => AtomicFile.write(path, `${JSON.stringify(JSON.parse(json), null, 2)}\n`),
            catch: failure,
          });
          yield* Ref.set(ref, next);
          return next;
        }),
    };
  });

export * as ModuleState from "./ModuleState.ts";
