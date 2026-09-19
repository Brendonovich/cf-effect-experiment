import type { Executor } from "@macrograph/execution";
import type { Engine, Module } from "@macrograph/module";

import { Editor } from "@macrograph/editor";
import { Effect } from "effect";

import { EngineHost } from "./EngineHost.ts";

export const register = <Definition extends Engine.AnyDef = never>(
  executor: Executor.Service,
  ...args:
    | readonly [module: Module.Module<never>]
    | readonly [
        module: Module.Module<Definition>,
        deployment: Engine.AnyDeploymentFor<Definition>,
        clientState: Effect.Effect<unknown>,
      ]
): Effect.Effect<void, never, Editor.Service> =>
  args.length === 1
    ? Effect.flatMap(Editor.Service, (editor) =>
        Effect.all([editor.module(args[0]), executor.module(args[0])], { discard: true }),
      )
    : EngineHost.mount(...args).pipe(Effect.andThen(executor.module(args[0], args[1])));

export * as ModuleMount from "./ModuleMount.ts";
