import { assert, describe, it } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import {
  ConnectionId,
  WebSocketClientEngine,
} from "@macrograph/plugin-websocket-client/Definition";
import { localLayer } from "@macrograph/plugin-websocket-client/Engine";
import { Effect, Layer, Result } from "effect";
import { Socket } from "effect/unstable/socket";

import { SpeakerBotEngine } from "../src/Definition.ts";
import speakerLayer from "../src/Engine.ts";

class MockWebSocket extends EventTarget {
  readyState = 0;
  closed = false;
  failSend = false;
  readonly sent: string[] = [];
  constructor(readonly url: string) {
    super();
    queueMicrotask(() => {
      this.readyState = 1;
      this.dispatchEvent(new Event("open"));
    });
  }
  send(data: string) {
    if (this.failSend) throw new Error("send failed");
    this.sent.push(data);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

describe("SpeakerBot transport adapter", () => {
  it.effect("mounts alongside the base engine without sharing storage, sessions or handlers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const id = ConnectionId.make("same-id");
        let speakerStorage: typeof SpeakerBotEngine.Storage.Type = {
          connections: [
            { id, name: "Speaker", url: "ws://localhost:7580", connectOnStartup: false },
          ],
        };
        let baseStorage: typeof WebSocketClientEngine.Storage.Type = {
          connections: [
            { id, name: "Generic", url: "ws://localhost:8080", connectOnStartup: false },
          ],
        };
        const sockets: MockWebSocket[] = [];
        const common = {
          credentials: {
            get: Effect.succeed([]),
            refresh: () => Effect.die("unused"),
            subscribe: () => Effect.void,
          },
          client: { refresh: Effect.void },
          emit: () => Effect.void,
          resource: { refresh: () => Effect.void },
        };
        const dependencies = Layer.mergeAll(
          Layer.succeed(Socket.WebSocketConstructor)((url) => {
            const socket = new MockWebSocket(url);
            sockets.push(socket);
            return socket as unknown as globalThis.WebSocket;
          }),
          Layer.succeed(SpeakerBotEngine.EngineContext)({
            ...common,
            storage: {
              get: Effect.sync(() => speakerStorage),
              set: (value) =>
                Effect.sync(() => {
                  speakerStorage = value;
                }),
              update: (update) =>
                Effect.sync(() => {
                  speakerStorage = update(speakerStorage);
                }),
            },
          }),
          Layer.succeed(WebSocketClientEngine.EngineContext)({
            ...common,
            storage: {
              get: Effect.sync(() => baseStorage),
              set: (value) =>
                Effect.sync(() => {
                  baseStorage = value;
                }),
              update: (update) =>
                Effect.sync(() => {
                  baseStorage = update(baseStorage);
                }),
            },
          }),
        );
        const built = yield* Layer.build(
          Layer.merge(speakerLayer, localLayer).pipe(Layer.provide(dependencies)),
        );
        const speaker = yield* EngineTest.makeClients(SpeakerBotEngine).pipe(
          Effect.provideContext(built),
        );
        const base = yield* EngineTest.makeClients(WebSocketClientEngine).pipe(
          Effect.provideContext(built),
        );
        yield* speaker.client.SpeakerBotWebSocketConnect({ id });
        yield* base.client.WebSocketConnect({ id });
        const speakerSocket = sockets.find((socket) => socket.url === "ws://localhost:7580/")!;
        const baseSocket = sockets.find((socket) => socket.url === "ws://localhost:8080/")!;
        yield* speaker.runtime.SpeakerBotWebSocketSendMessage({
          connectionId: id,
          data: '{"id":"Macrograph","request":"Stop"}',
        });
        yield* base.runtime.WebSocketSendMessage({ connectionId: id, data: "generic" });
        assert.deepStrictEqual(speakerSocket.sent, ['{"id":"Macrograph","request":"Stop"}']);
        assert.deepStrictEqual(baseSocket.sent, ["generic"]);
        speakerSocket.failSend = true;
        assert.isTrue(
          Result.isFailure(
            yield* Effect.result(
              speaker.runtime.SpeakerBotWebSocketSendMessage({ connectionId: id, data: "fail" }),
            ),
          ),
        );
        yield* speaker.client.SpeakerBotWebSocketDisconnect({ id });
        assert.isTrue(speakerSocket.closed);
        assert.isFalse(baseSocket.closed);
        assert.isFalse(speakerStorage.connections[0]!.connectOnStartup);
        assert.isTrue(baseStorage.connections[0]!.connectOnStartup);
        assert.isTrue(
          Result.isFailure(
            yield* Effect.result(
              speaker.runtime.SpeakerBotWebSocketSendMessage({
                connectionId: id,
                data: "disconnected",
              }),
            ),
          ),
        );
        const added = yield* speaker.client.SpeakerBotWebSocketAddConnection({
          name: "Second",
          url: "ws://127.0.0.1:7580",
        });
        assert.strictEqual(speakerStorage.connections.length, 2);
        assert.strictEqual(baseStorage.connections.length, 1);
        yield* speaker.client.SpeakerBotWebSocketRemoveConnection({ id: added });
        assert.strictEqual(speakerStorage.connections.length, 1);
      }),
    ),
  );
});
