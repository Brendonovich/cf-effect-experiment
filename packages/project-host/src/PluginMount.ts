import { Editor } from "@macrograph/editor";
import type { Executor } from "@macrograph/execution";
import { Engine, type Plugin } from "@macrograph/plugin";
import { Effect } from "effect";

import { EngineHost } from "./EngineHost.ts";

export const register = <Definition extends Engine.AnyDef>(
  executor: Executor.Service,
  plugin: Plugin.Plugin<Definition>,
  deployment: Engine.AnyDeploymentFor<Definition>,
  clientState: Effect.Effect<unknown>,
): Effect.Effect<void, never, Editor.Service> =>
  Effect.all(
    [EngineHost.mount(plugin, deployment, clientState), executor.plugin(plugin, deployment)],
    { discard: true },
  );

export * as PluginMount from "./PluginMount.ts";
