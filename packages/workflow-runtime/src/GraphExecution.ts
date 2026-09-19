import type { Project } from "@macrograph/core";
import type * as Executor from "@macrograph/execution/Executor";
import type { Registry as ModuleRegistry } from "@macrograph/project-host/ExecutorModules";

import { ProjectExecutor } from "@macrograph/project-host";
import { Effect } from "effect";

export interface Input {
  readonly projectId: string;
  readonly moduleId: string;
  readonly event: unknown;
}

export interface Options {
  readonly executionEnvironment: Executor.ExecutionEnvironment;
  readonly modules: ModuleRegistry;
  readonly engineClient?: NonNullable<Executor.MakeOptions["engineClient"]>;
}

export const run = Effect.fnUntraced(function* (
  project: Project.Model,
  input: Input,
  options: Options,
) {
  const executor = yield* ProjectExecutor.make(project, {
    projectId: input.projectId,
    executionEnvironment: options.executionEnvironment,
    modules: options.modules,
    ...(options.engineClient === undefined ? {} : { engineClient: options.engineClient }),
  });
  yield* options.modules.handle(executor, input.moduleId, input.event);
});

export * as GraphExecution from "./GraphExecution.ts";
