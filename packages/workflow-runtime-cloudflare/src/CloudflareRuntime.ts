import * as Executor from "@macrograph/execution/Executor";
import { ExecutionStep } from "@macrograph/workflow-runtime";
import { Cause, Effect } from "effect";

/** The subset of Cloudflare's native WorkflowStep used by graph execution. */
export interface WorkflowStep {
  do<A extends StepResult>(name: string, callback: () => Promise<A>): Promise<A>;
}

export type StepResult = Executor.SerializedNodeExecutionResult | void;

export interface Task {
  <A extends StepResult>(name: string, effect: Effect.Effect<A>): Effect.Effect<A>;
}

export interface Options {
  /** App-owned tracing inside the durable node step. */
  readonly decorateNode?: (
    key: Executor.NodeExecutionKey,
    name: ExecutionStep.NodeStepName,
    effect: Effect.Effect<Executor.SerializedNodeExecutionResult>,
  ) => Effect.Effect<Executor.SerializedNodeExecutionResult>;
  /** App-owned persistence; each transition is itself a durable step. */
  readonly onNodeState?: (
    key: Executor.NodeExecutionKey,
    name: ExecutionStep.NodeStepName,
    state: NodeState,
  ) => Effect.Effect<void>;
}

export interface NodeState {
  readonly status: "running" | "complete" | "errored";
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly error?: string;
}

/** Run with a native WorkflowStep, without loading Alchemy. */
export const makeTask =
  (step: WorkflowStep): Task =>
  (name, effect) =>
    Effect.context<never>().pipe(
      Effect.flatMap((context) =>
        Effect.tryPromise(() =>
          step.do(name, () => Effect.runPromise(effect.pipe(Effect.provide(context)))),
        ),
      ),
      Effect.orDie,
    );

export const makeExecutionEnvironment = (task: Task, options: Options = {}) =>
  Executor.durableExecution((key, executor) => {
    const name = ExecutionStep.nodeStepName(key);
    const effect = executor.executeNode(key).pipe(Effect.orDie);
    const execute = task(name, options.decorateNode?.(key, name, effect) ?? effect);
    const onNodeState = options.onNodeState;
    if (onNodeState === undefined) return execute;
    return Effect.gen(function* () {
      const startedAt = new Date().toISOString();
      yield* task(`${name}/trace-start`, onNodeState(key, name, { status: "running", startedAt }));
      const result = yield* execute.pipe(
        Effect.catchCause((cause) =>
          task(
            `${name}/trace-error`,
            onNodeState(key, name, {
              status: "errored",
              startedAt,
              completedAt: new Date().toISOString(),
              error: String(Cause.squash(cause)),
            }),
          ).pipe(Effect.andThen(Effect.failCause(cause))),
        ),
      );
      yield* task(
        `${name}/trace-complete`,
        onNodeState(key, name, {
          status: "complete",
          startedAt,
          completedAt: new Date().toISOString(),
        }),
      );
      return result;
    });
  });
