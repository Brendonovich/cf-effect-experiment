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
  outNodeId: Schema.String.annotate({
    description: "Output node ID, or its temporary local ID when creating a complete graph.",
  }),
  outIoId: IoId.annotate({ description: "Output execution or data port ID from the node schema." }),
  inNodeId: Schema.String.annotate({
    description: "Input node ID, or its temporary local ID when creating a complete graph.",
  }),
  inIoId: IoId.annotate({ description: "Input execution or data port ID from the node schema." }),
});
export type CreateInput = typeof CreateInput.Type;

export class InvalidError extends Schema.TaggedError<InvalidError>()(
  "InvalidConnectionError",
  { reason: Schema.String },
) {}

export * as Connection from "./Connection.ts";
