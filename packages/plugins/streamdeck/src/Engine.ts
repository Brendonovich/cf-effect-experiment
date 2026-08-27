import * as WebSocket from "@macrograph/plugin-websocket-server/Definition";
import { make } from "@macrograph/plugin-websocket-server/Engine";
import { Adapter } from "@macrograph/plugin-websocket-server/Listener";
import { Effect, Layer } from "effect";

import { ClientRpcs, StreamDeckEngine, StreamDeckServer } from "./Definition.ts";
import { makeReceiver } from "./Protocol.ts";

export const layer = Layer.effect(StreamDeckEngine)(
  Effect.gen(function* () {
    const context = yield* StreamDeckEngine.EngineContext;
    const adapter = yield* Adapter;
    const base = yield* make(adapter).pipe(
      Effect.provideService(WebSocket.WebSocketServerEngine.EngineContext, {
        ...context,
        resource: { refresh: () => context.resource.refresh(StreamDeckServer) },
        emit: makeReceiver(context.emit),
      }),
    );
    const add = yield* WebSocket.ClientRpcs.accessHandler("WebSocketServerAdd").pipe(
      Effect.provide(base.client.rpcs),
    );
    const update = yield* WebSocket.ClientRpcs.accessHandler("WebSocketServerUpdate").pipe(
      Effect.provide(base.client.rpcs),
    );
    const remove = yield* WebSocket.ClientRpcs.accessHandler("WebSocketServerRemove").pipe(
      Effect.provide(base.client.rpcs),
    );
    const start = yield* WebSocket.ClientRpcs.accessHandler("WebSocketServerStart").pipe(
      Effect.provide(base.client.rpcs),
    );
    const stop = yield* WebSocket.ClientRpcs.accessHandler("WebSocketServerStop").pipe(
      Effect.provide(base.client.rpcs),
    );
    const status = yield* WebSocket.ClientRpcs.accessHandler("WebSocketServerStatus").pipe(
      Effect.provide(base.client.rpcs),
    );
    return StreamDeckEngine.of({
      resources: StreamDeckServer.toLayer(
        base.client.state.pipe(
          Effect.map(({ servers }) =>
            servers.map(({ definition }) => ({ id: definition.id, display: definition.name })),
          ),
        ),
      ),
      rpcs: Layer.empty,
      client: {
        state: base.client.state,
        rpcs: ClientRpcs.toLayer({
          StreamDeckWebSocketServerAdd: add,
          StreamDeckWebSocketServerUpdate: update,
          StreamDeckWebSocketServerRemove: remove,
          StreamDeckWebSocketServerStart: start,
          StreamDeckWebSocketServerStop: stop,
          StreamDeckWebSocketServerStatus: status,
        }),
      },
    });
  }),
);

export default layer;
