import type * as Executor from "@macrograph/execution/Executor";

import { Schema } from "effect";

export const NodeStepName = Schema.String.pipe(Schema.brand("WorkflowNodeStepName"));
export type NodeStepName = typeof NodeStepName.Type;

export const nodeStepName = (key: Executor.NodeExecutionKey): NodeStepName =>
  NodeStepName.make(
    `runtime-node-v2/${key.kind}/${encodeURIComponent(key.graphId)}/${encodeURIComponent(key.eventNodeId)}/${encodeURIComponent(key.executionPath)}/${encodeURIComponent(key.nodeId)}`,
  );

export * as ExecutionStep from "./ExecutionStep.ts";
