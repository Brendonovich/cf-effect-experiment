import { Project } from "@macrograph/core";
import { Executor } from "@macrograph/execution";
import { Effect } from "effect";

import type { Registry as PluginRegistry } from "./ExecutorPlugins.ts";

export interface MakeOptions extends Executor.MakeOptions {
  readonly plugins?: PluginRegistry;
}

export const make = Effect.fnUntraced(function* (
  project: Project.Model,
  options?: MakeOptions,
): Effect.fn.Return<Executor.Service> {
  const executor = yield* Executor.make(
    project,
    options?.executionDriver === undefined
      ? undefined
      : { executionDriver: options.executionDriver },
  );
  if (options?.plugins !== undefined) yield* options.plugins.register(executor);
  return executor;
});

export * as ProjectExecutor from "./ProjectExecutor.ts";
