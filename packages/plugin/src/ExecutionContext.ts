import type { Effect } from "effect";

export interface ExecutionContext {
  readonly projectId: string;
  readonly graphId: string;
  readonly eventNodeId: string;
  readonly traceId: string;
}

export interface NodeExecutionContext {
  readonly nodeId: string;
  readonly kind: "event" | "exec" | "pure";
  readonly executionPath: string;
  readonly traceId: string;
  readonly parentTraceId?: string;
  readonly withSpan: <A, E, R>(
    name: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

export * as ExecutionContext from "./ExecutionContext.ts";
