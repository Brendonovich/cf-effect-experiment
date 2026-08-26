import { DataType } from "@macrograph/plugin/DataType";
import { Schema } from "effect";

export const IoId = Schema.String.pipe(Schema.brand("IoId"));
export type IoId = typeof IoId.Type;

export const ExecutionPort = Schema.Struct({
  id: IoId,
  name: Schema.optional(Schema.String),
});
export type ExecutionPort = typeof ExecutionPort.Type;

export const DataPort = Schema.Struct({
  id: IoId,
  name: Schema.optional(Schema.String),
  type: DataType.Descriptor,
  defaultValue: Schema.optional(Schema.Json),
  suggestions: Schema.optional(Schema.Boolean),
});
export type DataPort = typeof DataPort.Type;

export const NodeIO = Schema.Struct({
  dataInputs: Schema.Array(DataPort),
  dataOutputs: Schema.Array(DataPort),
  executionInputs: Schema.Array(ExecutionPort),
  executionOutputs: Schema.Array(ExecutionPort),
});
export type NodeIO = typeof NodeIO.Type;
