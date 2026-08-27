import { Engine, Resource } from "@macrograph/plugin";
import * as WebSocket from "@macrograph/plugin-websocket-server/Definition";
import { Array, Schema } from "effect";

export {
  ServerId,
  ClientId,
  ClientState,
  RuntimeStorage,
} from "@macrograph/plugin-websocket-server/Definition";
export const ClientRpcs = WebSocket.ClientRpcs.prefix("StreamDeck");
export const DEFAULT_PORT = 1880;

export const KeyMessage = Schema.Struct({
  event: Schema.Literals(["keyDown", "keyUp"]),
  payload: Schema.Struct({
    coordinates: Schema.Struct({ column: Schema.Finite, row: Schema.Finite }),
    isInMultiAction: Schema.Boolean,
    settings: Schema.Struct({ id: Schema.String, remoteServer: Schema.String }),
  }),
});

export class KeyEvent extends Schema.TaggedClass<KeyEvent>()("StreamDeckKeyEvent", {
  serverId: WebSocket.ServerId,
  clientId: WebSocket.ClientId,
  event: KeyMessage.fields.event,
  payload: KeyMessage.fields.payload,
}) {}

export class StreamDeckServer extends Resource.make<StreamDeckServer, WebSocket.ServerId>()(
  "StreamDeckServer",
  {
    name: "Stream Deck Server",
    description: "A local Stream Deck WebSocket listener (default port 1880).",
  },
) {}

export class StreamDeckEngine extends Engine.make({
  resources: [StreamDeckServer],
  events: Array.empty<KeyEvent>(),
  storage: WebSocket.RuntimeStorage,
  initialStorage: { servers: [] },
  client: { state: WebSocket.ClientState, rpcs: ClientRpcs },
}) {}
