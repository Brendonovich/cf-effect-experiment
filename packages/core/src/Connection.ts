import { Schema } from "effect";

import { IoId } from "./IO.ts";
import * as OutputRef from "./OutputRef.ts";

export const ConnectionId = Schema.String.pipe(Schema.brand("ConnectionId"));
export type ConnectionId = typeof ConnectionId.Type;

export const Model = Schema.Struct({
  id: ConnectionId,
  outNodeId: Schema.String,
  outIo: OutputRef.Model,
  inNodeId: Schema.String,
  inIoId: IoId,
});
export type Model = typeof Model.Type;

export const CreateInput = Schema.Struct({
  outNodeId: Schema.String.annotate({
    description: "Output node ID, or its temporary local ID when creating a complete graph.",
  }),
  outIo: OutputRef.Model.annotate({
    description: "Declared output, scope execution, or scope field reference.",
  }),
  inNodeId: Schema.String.annotate({
    description: "Input node ID, or its temporary local ID when creating a complete graph.",
  }),
  inIoId: IoId.annotate({ description: "Input execution or data port ID from the node schema." }),
});
export type CreateInput = typeof CreateInput.Type;

export class InvalidError extends Schema.TaggedError<InvalidError>()("InvalidConnectionError", {
  reason: Schema.String,
}) {}

export * as Connection from "./Connection.ts";
