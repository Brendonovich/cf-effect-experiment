import { Engine, Resource } from "@macrograph/module";
import * as WebSocket from "@macrograph/module-websocket-client/Definition";

export {
  ConnectionId,
  ClientState,
  RuntimeStorage,
} from "@macrograph/module-websocket-client/Definition";
export const ClientRpcs = WebSocket.ClientRpcs.prefix("SpeakerBot");
export const RuntimeRpcs = WebSocket.RuntimeRpcs.prefix("SpeakerBot");

export class SpeakerBotConnection extends Resource.make<
  SpeakerBotConnection,
  WebSocket.ConnectionId
>()("SpeakerBotConnection", {
  name: "SpeakerBot Connection",
  description: "A configured local SpeakerBot WebSocket connection (no authentication).",
}) {}

export class SpeakerBotEngine extends Engine.make({
  resources: [SpeakerBotConnection],
  storage: WebSocket.RuntimeStorage,
  initialStorage: { connections: [] },
  rpcs: RuntimeRpcs,
  client: { state: WebSocket.ClientState, rpcs: ClientRpcs },
}) {}
