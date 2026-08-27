import type { Executor } from "@macrograph/execution";

import { Editor } from "@macrograph/editor";
import type { Engine, Plugin } from "@macrograph/plugin";
import { Effect } from "effect";

import { EngineHost } from "./EngineHost.ts";

export const register = <Definition extends Engine.AnyDef = never>(
  executor: Executor.Service,
  ...args:
    | readonly [plugin: Plugin.Plugin<never>]
    | readonly [
        plugin: Plugin.Plugin<Definition>,
        deployment: Engine.AnyDeploymentFor<Definition>,
        clientState: Effect.Effect<unknown>,
      ]
): Effect.Effect<void, never, Editor.Service> =>
  args.length === 1
    ? Effect.flatMap(Editor.Service, (editor) =>
        Effect.all([editor.plugin(args[0]), executor.plugin(args[0])], { discard: true }),
      )
    : Effect.all([EngineHost.mount(...args), executor.plugin(args[0], args[1])], { discard: true });

export * as PluginMount from "./PluginMount.ts";
