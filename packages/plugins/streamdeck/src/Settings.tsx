import Settings from "@macrograph/plugin-websocket-server/Settings";
import { ClientSettings } from "@macrograph/plugin/ClientSettings";
import { Effect } from "effect";
import { createSignal } from "solid-js";

import { ClientRpcs, ClientState, DEFAULT_PORT } from "./Definition.ts";
import plugin from "./Plugin.ts";

export const settings = ClientSettings.make({
  plugin,
  state: ClientState,
  initial: { servers: [] },
  rpcs: ClientRpcs,
  render: (state, context) => {
    const [error, setError] = createSignal("");
    const [adding, setAdding] = createSignal(false);
    return (
      <>
        <p>
          Local deployments only. The first connected Stream Deck client supplies key events. Stream
          Deck's default port is {DEFAULT_PORT}; custom listeners can be added below.
        </p>
        <button
          type="button"
          disabled={adding()}
          onClick={() => {
            setAdding(true);
            setError("");
            void Effect.runPromise(
              context.rpc.StreamDeckWebSocketServerAdd({
                name: "Stream Deck",
                host: "127.0.0.1",
                port: DEFAULT_PORT,
              }),
            )
              .then(
                () => context.onChanged(),
                (reason: unknown) => setError(String(reason)),
              )
              .finally(() => setAdding(false));
          }}
        >
          Add Stream Deck Listener (1880)
        </button>
        <p role="status">{error()}</p>
        <Settings
          state={state}
          onChanged={context.onChanged}
          rpc={{
            WebSocketServerAdd: context.rpc.StreamDeckWebSocketServerAdd,
            WebSocketServerUpdate: context.rpc.StreamDeckWebSocketServerUpdate,
            WebSocketServerRemove: context.rpc.StreamDeckWebSocketServerRemove,
            WebSocketServerStart: context.rpc.StreamDeckWebSocketServerStart,
            WebSocketServerStop: context.rpc.StreamDeckWebSocketServerStop,
          }}
        />
      </>
    );
  },
  renderInvalid: () => <p>Stream Deck settings state is unavailable.</p>,
});
