import type { Executor } from "@macrograph/execution";
import { Engine, type Plugin } from "@macrograph/plugin";
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

export const entry = <Definition extends Engine.AnyDef>(
  plugin: Plugin.Plugin<Definition>,
  event: Schema.Codec<Engine.EventOf<Definition>, unknown, never, never>,
  deployment: Engine.AnyDeploymentFor<Definition>,
): Entry => ({
  id: plugin.id,
  register: (executor) => executor.plugin(plugin, deployment),
  handle: (executor, input) =>
    Schema.decodeUnknownEffect(event)(input).pipe(
      Effect.flatMap((decoded) => executor.handleEvent(plugin, decoded)),
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
