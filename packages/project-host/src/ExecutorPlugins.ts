import type { Executor } from "@macrograph/execution";
import type { Engine, Plugin } from "@macrograph/plugin";

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
    pluginId: string,
    event: unknown,
  ) => Effect.Effect<void, Executor.ExecutorError | Schema.SchemaError>;
}

export const entry = <Definition extends Engine.AnyDef = never>(
  ...args:
    | readonly [plugin: Plugin.Plugin<never>]
    | readonly [
        plugin: Plugin.Plugin<Definition>,
        event: Schema.Codec<Engine.EventOf<Definition>, unknown, never, never>,
        deployment: Engine.AnyDeploymentFor<Definition>,
      ]
): Entry => ({
  id: args[0].id,
  register: (executor) =>
    args.length === 1 ? executor.plugin(args[0]) : executor.plugin(args[0], args[2]),
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
    Effect.forEach(entries, (plugin) => plugin.register(executor), { discard: true }),
  handle: (executor: Executor.Service, pluginId: string, event: unknown) => {
    const plugin = entries.find((candidate) => candidate.id === pluginId);
    return plugin === undefined
      ? Effect.die(`Executor plugin ${pluginId} is not registered`)
      : plugin.handle(executor, event);
  },
});

export * as ExecutorPlugins from "./ExecutorPlugins.ts";
