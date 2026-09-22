import type * as Executor from "@macrograph/execution/Executor";
import type { Registry as ModuleRegistry } from "@macrograph/project-host/ExecutorModules";

import { Project } from "@macrograph/core";
import { ProjectExecutor } from "@macrograph/project-host";
import { GraphExecution, NodeExecution } from "@macrograph/workflow-runtime";
import { Effect, Schema } from "effect";

export const ExecutionInput = Schema.Struct({
  executionId: Schema.String,
  projectId: Schema.String,
  moduleId: Schema.String,
  event: Schema.Json,
  project: Project.Model,
});
export type ExecutionInput = typeof ExecutionInput.Type;

export const ExecutionResult = Schema.Struct({
  executionId: Schema.String,
  projectId: Schema.String,
});
export type ExecutionResult = typeof ExecutionResult.Type;

export const NodeStepInput = Schema.Struct({
  project: Project.Model,
  request: NodeExecution.Request,
});
export type NodeStepInput = typeof NodeStepInput.Type;

export interface WorkflowOptions {
  readonly modules: ModuleRegistry;
  readonly executeNode: (input: NodeStepInput) => Promise<Executor.NodeExecutionResult>;
}

export interface NodeStepOptions<E = never> {
  readonly modules: ModuleRegistry;
  readonly makeEngineClient?: (
    project: Project.Model,
  ) => Effect.Effect<NonNullable<Executor.MakeOptions["engineClient"]>, E>;
}

export const runWorkflow = async (
  input: ExecutionInput,
  options: WorkflowOptions,
): Promise<ExecutionResult> => {
  // Workflow SDK serializes a step call's receiver as well as its arguments.
  // Calling options.executeNode would capture the non-serializable registry.
  const { executeNode } = options;
  return Effect.runPromise(
    GraphExecution.run(
      input.project,
      { projectId: input.projectId, moduleId: input.moduleId, event: input.event },
      {
        modules: options.modules,
        executionEnvironment: {
          _tag: "Serialized",
          executeNode: (request) =>
            Schema.decodeUnknownEffect(NodeExecution.Request)(request).pipe(
              Effect.flatMap((request) =>
                Effect.tryPromise({
                  try: () => executeNode({ project: input.project, request }),
                  catch: (cause) => cause,
                }),
              ),
              Effect.flatMap(Schema.decodeUnknownEffect(NodeExecution.Result)),
              Effect.orDie,
            ),
        },
      },
    ).pipe(Effect.orDie, Effect.as({ executionId: input.executionId, projectId: input.projectId })),
  );
};

export const runNodeStep = async <E = never>(
  input: NodeStepInput,
  options: NodeStepOptions<E>,
): Promise<Executor.NodeExecutionResult> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const engineClient =
        options.makeEngineClient === undefined
          ? undefined
          : yield* options.makeEngineClient(input.project).pipe(Effect.orDie);
      const executor = yield* ProjectExecutor.make(input.project, {
        modules: options.modules,
        ...(engineClient === undefined ? {} : { engineClient }),
      });
      return yield* executor.executeSerializedNode(input.request).pipe(Effect.orDie);
    }),
  );

export * as VercelRuntime from "./VercelRuntime.ts";
