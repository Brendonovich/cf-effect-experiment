import * as WebSocket from "@macrograph/plugin-websocket-server/Definition";
import { Effect, Result, Schema } from "effect";

import { KeyEvent, KeyMessage } from "./Definition.ts";

export const makeReceiver = (emit: (event: KeyEvent) => Effect.Effect<void>) => {
  const clients = new Map<WebSocket.ServerId, WebSocket.ClientId>();
  return Effect.fnUntraced(function* (event: typeof WebSocket.ServerEvent.Type) {
    if (event._tag === "WebSocketServerClientConnected") {
      if (!clients.has(event.serverId)) clients.set(event.serverId, event.clientId);
      return;
    }
    if (event.clientId !== clients.get(event.serverId)) return;
    if (event._tag === "WebSocketServerClientDisconnected") {
      clients.delete(event.serverId);
      return;
    }
    const decoded = yield* Effect.try({
      try: () => JSON.parse(event.message) as unknown,
      catch: (error) => error,
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(KeyMessage)), Effect.result);
    if (Result.isFailure(decoded))
      return yield* Effect.logWarning("Dropped malformed Stream Deck key message", {
        serverId: event.serverId,
      });
    yield* emit(
      new KeyEvent({ serverId: event.serverId, clientId: event.clientId, ...decoded.success }),
    );
  });
};
