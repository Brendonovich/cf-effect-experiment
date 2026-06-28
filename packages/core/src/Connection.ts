import { Schema } from "effect";

import { IoId } from "./IO.ts";

export const ConnectionId = Schema.String.pipe(Schema.brand("ConnectionId"));
export type ConnectionId = typeof ConnectionId.Type;

export class Model extends Schema.Class<Model>("Connection")({
  id: ConnectionId,
  outNodeId: Schema.String,
  outIoId: IoId,
  inNodeId: Schema.String,
  inIoId: IoId,
}) {}

export class CreateInput extends Schema.Class<CreateInput>("ConnectionCreateInput")({
  outNodeId: Schema.String,
  outIoId: IoId,
  inNodeId: Schema.String,
  inIoId: IoId,
}) {}

export * as Connection from "./Connection.ts";
