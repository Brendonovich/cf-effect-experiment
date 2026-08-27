import * as WebSocket from "@macrograph/plugin-websocket-client/Definition";
import { make } from "@macrograph/plugin-websocket-client/Engine";
import { localLayer as policy } from "@macrograph/plugin-websocket-client/UrlPolicy";
import { Effect, Layer } from "effect";

import { ClientRpcs, RuntimeRpcs, SpeakerBotConnection, SpeakerBotEngine } from "./Definition.ts";

export const layer = Layer.effect(SpeakerBotEngine)(
  Effect.gen(function* () {
    const context = yield* SpeakerBotEngine.EngineContext;
    const base = yield* make().pipe(
      Effect.provideService(WebSocket.WebSocketClientEngine.EngineContext, {
        ...context,
        resource: { refresh: () => context.resource.refresh(SpeakerBotConnection) },
        emit: () => Effect.void,
      }),
    );
    const send = yield* WebSocket.RuntimeRpcs.accessHandler("WebSocketSendMessage").pipe(
      Effect.provide(base.rpcs),
    );
    const add = yield* WebSocket.ClientRpcs.accessHandler("WebSocketAddConnection").pipe(
      Effect.provide(base.client.rpcs),
    );
    const update = yield* WebSocket.ClientRpcs.accessHandler("WebSocketUpdateConnection").pipe(
      Effect.provide(base.client.rpcs),
    );
    const remove = yield* WebSocket.ClientRpcs.accessHandler("WebSocketRemoveConnection").pipe(
      Effect.provide(base.client.rpcs),
    );
    const connect = yield* WebSocket.ClientRpcs.accessHandler("WebSocketConnect").pipe(
      Effect.provide(base.client.rpcs),
    );
    const disconnect = yield* WebSocket.ClientRpcs.accessHandler("WebSocketDisconnect").pipe(
      Effect.provide(base.client.rpcs),
    );
    return SpeakerBotEngine.of({
      resources: SpeakerBotConnection.toLayer(
        base.client.state.pipe(
          Effect.map(({ connections }) =>
            connections.map(({ definition }) => ({ id: definition.id, display: definition.name })),
          ),
        ),
      ),
      rpcs: RuntimeRpcs.toLayer({ SpeakerBotWebSocketSendMessage: send }),
      client: {
        state: base.client.state,
        rpcs: ClientRpcs.toLayer({
          SpeakerBotWebSocketAddConnection: add,
          SpeakerBotWebSocketUpdateConnection: update,
          SpeakerBotWebSocketRemoveConnection: remove,
          SpeakerBotWebSocketConnect: connect,
          SpeakerBotWebSocketDisconnect: disconnect,
        }),
      },
    });
  }),
).pipe(Layer.provide(policy));

export default layer;
