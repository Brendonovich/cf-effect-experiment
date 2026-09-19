import type * as Executor from "@macrograph/execution/Executor";
import type { Registry as ModuleRegistry } from "@macrograph/project-host/ExecutorModules";

import { Project } from "@macrograph/core";
import { ExecutionStep, GraphExecution, NodeExecution } from "@macrograph/workflow-runtime";
import { Effect, Layer, Schema } from "effect";
import { ClusterWorkflowEngine } from "effect/unstable/cluster";
import { Activity, Workflow, WorkflowEngine } from "effect/unstable/workflow";

export const ExecutionResult = Schema.Struct({
  executionId: Schema.String,
  projectId: Schema.String,
});

export const GraphExecutionWorkflow = Workflow.make("MacroGraphGraphExecution", {
  payload: {
    executionId: Schema.String,
    projectId: Schema.String,
    moduleId: Schema.String,
    event: Schema.Json,
    project: Project.Model,
  },
  success: ExecutionResult,
  idempotencyKey: ({ executionId }) => executionId,
});

export interface Options<E = never, R = never> {
  readonly modules: ModuleRegistry;
  readonly makeEngineClient?: (
    project: Project.Model,
  ) => Effect.Effect<NonNullable<Executor.MakeOptions["engineClient"]>, E, R>;
}

export const makeExecutionEnvironment = Effect.fnUntraced(function* () {
  const workflowEngine = yield* WorkflowEngine.WorkflowEngine;
  const workflowInstance = yield* WorkflowEngine.WorkflowInstance;
  return {
    _tag: "Durable",
    executeNode: (key, nodeExecutor) =>
      Activity.make({
        name: ExecutionStep.nodeStepName(key),
        success: NodeExecution.Result,
        execute: nodeExecutor
          .executeNode(key)
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(NodeExecution.Result)), Effect.orDie),
      }).pipe(
        Effect.provideService(WorkflowEngine.WorkflowEngine, workflowEngine),
        Effect.provideService(WorkflowEngine.WorkflowInstance, workflowInstance),
      ),
  } satisfies Executor.DurableExecutionEnvironment;
});

export const layer = <E = never, R = never>(options: Options<E, R>) =>
  GraphExecutionWorkflow.toLayer(
    Effect.fnUntraced(function* (payload) {
      const executionEnvironment = yield* makeExecutionEnvironment();
      const engineClient =
        options.makeEngineClient === undefined
          ? undefined
          : yield* options.makeEngineClient(payload.project).pipe(Effect.orDie);
      yield* GraphExecution.run(
        payload.project,
        {
          projectId: payload.projectId,
          moduleId: payload.moduleId,
          event: payload.event,
        },
        {
          executionEnvironment,
          modules: options.modules,
          ...(engineClient === undefined ? {} : { engineClient }),
        },
      ).pipe(Effect.orDie);
      return { executionId: payload.executionId, projectId: payload.projectId };
    }),
  );

export const clusterEngineLayer = ClusterWorkflowEngine.layer;

export const runtimeLayer = <E = never, R = never>(options: Options<E, R>) =>
  layer(options).pipe(Layer.provideMerge(clusterEngineLayer));

export * as EffectClusterRuntime from "./EffectClusterRuntime.ts";
