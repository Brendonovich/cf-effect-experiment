import { Schema } from "effect";

export const IoId = Schema.String.pipe(Schema.brand("IoId"));
export type IoId = typeof IoId.Type;

export const ExecutionPort = Schema.Struct({
  id: IoId,
  name: Schema.optional(Schema.String),
});
export type ExecutionPort = typeof ExecutionPort.Type;
