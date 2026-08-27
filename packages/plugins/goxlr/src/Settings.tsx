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
        Connect to GoXLR Utility's daemon, typically ws://127.0.0.1:14564/api/websocket. The first
        mixer in its status is selected. Local deployments only; no authentication is required.
      </p>
      <Settings
        state={state}
        onChanged={context.onChanged}
        rpc={{
          WebSocketAddConnection: context.rpc.GoXLRWebSocketAddConnection,
          WebSocketUpdateConnection: context.rpc.GoXLRWebSocketUpdateConnection,
          WebSocketRemoveConnection: context.rpc.GoXLRWebSocketRemoveConnection,
          WebSocketConnect: context.rpc.GoXLRWebSocketConnect,
          WebSocketDisconnect: context.rpc.GoXLRWebSocketDisconnect,
        }}
      />
    </>
  ),
  renderInvalid: () => <p>GoXLR settings state is unavailable.</p>,
});
