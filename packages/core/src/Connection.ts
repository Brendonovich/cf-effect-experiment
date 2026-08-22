import { Schema } from "effect";

import { IoId } from "./IO.ts";

export const ConnectionId = Schema.String.pipe(Schema.brand("ConnectionId"));
export type ConnectionId = typeof ConnectionId.Type;

export const Model = Schema.Struct({
  id: ConnectionId,
  outNodeId: Schema.String,
  outIoId: IoId,
  inNodeId: Schema.String,
  inIoId: IoId,
});
export type Model = typeof Model.Type;

export const CreateInput = Schema.Struct({
  outNodeId: Schema.String,
  outIoId: IoId,
  inNodeId: Schema.String,
  inIoId: IoId,
});
export type CreateInput = typeof CreateInput.Type;

export class InvalidError extends Schema.TaggedErrorClass<InvalidError>()(
  "InvalidConnectionError",
  { reason: Schema.String },
) {}

export * as Connection from "./Connection.ts";
