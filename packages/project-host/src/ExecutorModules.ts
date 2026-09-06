import type { Executor } from "@macrograph/execution";
import type { Engine, Module } from "@macrograph/module";

import { Effect, Schema } from "effect";

export interface Entry {
  readonly id: string;
  readonly register: (executor: Executor.Service) => Effect.Effect<void>;
  readonly handle: (
    executor: Executor.Service,
    event: unknown,
  ) => Effect.Effect<void, Executor.ExecutorError | Schema.SchemaError>;
}

export interface Registry {
  readonly entries: ReadonlyArray<Entry>;
  readonly register: (executor: Executor.Service) => Effect.Effect<void>;
  readonly handle: (
    executor: Executor.Service,
    moduleId: string,
    event: unknown,
  ) => Effect.Effect<void, Executor.ExecutorError | Schema.SchemaError>;
}

export const entry = <Definition extends Engine.AnyDef = never>(
  ...args:
    | readonly [module: Module.Module<never>]
    | readonly [
        module: Module.Module<Definition>,
        event: Schema.Codec<Engine.EventOf<Definition>, unknown, never, never>,
        deployment: Engine.AnyDeploymentFor<Definition>,
      ]
): Entry => ({
  id: args[0].id,
  register: (executor) =>
    args.length === 1 ? executor.module(args[0]) : executor.module(args[0], args[2]),
  handle: (executor, input) =>
    args.length === 1
      ? Schema.decodeUnknownEffect(Schema.Never)(input)
      : Schema.decodeUnknownEffect(args[1])(input).pipe(
          Effect.flatMap((decoded) => executor.handleEvent(args[0], decoded)),
        ),
});

export const make = (entries: ReadonlyArray<Entry>): Registry => ({
  entries,
  register: (executor: Executor.Service) =>
    Effect.forEach(entries, (module) => module.register(executor), { discard: true }),
  handle: (executor: Executor.Service, moduleId: string, event: unknown) => {
    const module = entries.find((candidate) => candidate.id === moduleId);
    return module === undefined
      ? Effect.die(`Executor module ${moduleId} is not registered`)
      : module.handle(executor, event);
  },
});

export * as ExecutorModules from "./ExecutorModules.ts";
