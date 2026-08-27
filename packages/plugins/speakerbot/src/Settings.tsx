import Settings from "@macrograph/plugin-websocket-client/Settings";
import { ClientSettings } from "@macrograph/plugin/ClientSettings";

import { ClientRpcs, ClientState } from "./Definition.ts";
import plugin from "./Plugin.ts";

export const settings = ClientSettings.make({
  plugin,
  state: ClientState,
  initial: { connections: [] },
  rpcs: ClientRpcs,
  render: (state, context) => (
    <>
      <p>
        Use SpeakerBot's configured WebSocket address, typically ws://127.0.0.1:7580. Local
        deployments only; no authentication is required.
      </p>
      <Settings
        state={state}
        onChanged={context.onChanged}
        rpc={{
          WebSocketAddConnection: context.rpc.SpeakerBotWebSocketAddConnection,
          WebSocketUpdateConnection: context.rpc.SpeakerBotWebSocketUpdateConnection,
          WebSocketRemoveConnection: context.rpc.SpeakerBotWebSocketRemoveConnection,
          WebSocketConnect: context.rpc.SpeakerBotWebSocketConnect,
          WebSocketDisconnect: context.rpc.SpeakerBotWebSocketDisconnect,
        }}
      />
    </>
  ),
  renderInvalid: () => <p>SpeakerBot settings state is unavailable.</p>,
});
