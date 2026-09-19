import { DataType } from "@macrograph/module";
import { Schema } from "effect";

export const Output = Schema.Struct({
  outputId: Schema.String,
  value: Schema.Json,
});

export const Result = Schema.Struct({
  outputs: Schema.Array(Output),
  executionOutputId: Schema.NullOr(Schema.String),
  scopePayload: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
});

export const Key = Schema.Struct({
  projectId: Schema.String,
  graphId: Schema.String,
  eventNodeId: Schema.String,
  nodeId: Schema.String,
  kind: Schema.Literals(["base", "event", "exec"]),
  executionPath: Schema.String,
  executionTraceId: Schema.String,
  traceId: Schema.String,
  parentTraceId: Schema.optionalKey(Schema.String),
});

export const Request = Schema.Struct({
  key: Key,
  moduleId: Schema.String,
  schemaId: Schema.String,
  inputs: Schema.Record(Schema.String, Schema.Json),
  properties: Schema.Record(Schema.String, Schema.Json),
  event: Schema.optionalKey(Schema.Json),
  types: DataType.Definitions,
  resolvedTypes: Schema.Record(Schema.String, DataType.Descriptor),
  precomputed: Schema.optionalKey(Result),
  scopeInput: Schema.optionalKey(
    Schema.Struct({
      inputId: Schema.String,
      payload: Schema.Record(Schema.String, Schema.Json),
    }),
  ),
});

export type Request = typeof Request.Type;

export * as NodeExecution from "./NodeExecution.ts";
