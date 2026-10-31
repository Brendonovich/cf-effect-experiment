import { Project } from "@macrograph/core";
import { Executor } from "@macrograph/execution";
import { Effect, type Scope } from "effect";

import type { Registry as ModuleRegistry } from "./ExecutorModules.ts";

export interface MakeOptions extends Executor.MakeOptions {
  readonly modules?: ModuleRegistry;
}

/** Makes an executor with the given modules registered until the current scope closes. */
export const make = Effect.fnUntraced(function* (
  project: Project.Model,
  options?: MakeOptions,
): Effect.fn.Return<Executor.Service, never, Scope.Scope> {
  const executor = yield* Executor.make(project, options);
  if (options?.modules !== undefined) yield* options.modules.register(executor);
  return executor;
});

export * as ProjectExecutor from "./ProjectExecutor.ts";
