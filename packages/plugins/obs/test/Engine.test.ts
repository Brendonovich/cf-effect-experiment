import { assert, describe, expect, it, vi } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Crypto, Deferred, Effect, Layer } from "effect";
import { Socket } from "effect/unstable/socket";

import type * as ObsEvent from "../src/Events.ts";

import { OBSEngine, OBSSocket, SocketAddress } from "../src/Definition.ts";
import deployment from "../src/Deployment/WebSocket.ts";

type Packet = {
  readonly op: number;
  readonly d: Record<string, unknown>;
};

class MockWebSocket extends EventTarget {
  readonly readyState = 1;
  readonly sent: Array<Packet> = [];

  constructor(readonly url: string) {
    super();
    queueMicrotask(() => {
      this.message({
        op: 0,
        d: {
          obsWebSocketVersion: "5.5.2",
          rpcVersion: 1,
          authentication: { challenge: "challenge", salt: "salt" },
        },
      });
    });
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (typeof data !== "string") throw new Error("Expected a text WebSocket frame");
    const packet = JSON.parse(data) as Packet;
    this.sent.push(packet);

    if (packet.op === 1) {
      queueMicrotask(() => this.message({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      return;
    }

    if (packet.op === 6) {
      const failed = packet.d.requestType === "Fail";
      queueMicrotask(() =>
        this.message({
          op: 7,
          d: {
            requestType: packet.d.requestType,
            requestId: packet.d.requestId,
            requestStatus: failed
              ? { result: false, code: 500, comment: "Request failed" }
              : { result: true, code: 100 },
            ...(failed ? {} : { responseData: { obsVersion: "31.0.0" } }),
          },
        }),
      );
    }
  }

  close() {}

  emit(eventType: string, eventData: Record<string, unknown>) {
    this.message({ op: 5, d: { eventType, eventIntent: 4, eventData } });
  }

  private message(packet: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(packet) }));
  }
}

describe("OBSEngine", () => {
  it.effect("manages sockets, forwards requests, and emits events", () =>
    Effect.gen(function* () {
      const address = SocketAddress.make("ws://localhost:4455");
      const crypto = Crypto.make({
        randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => index),
        digest: (_algorithm, data) => Effect.succeed(data),
      });
      const digest = (value: string) =>
        crypto.digest("SHA-256", new TextEncoder().encode(value)).pipe(
          Effect.map((bytes) => {
            let binary = "";
            for (const byte of bytes) binary += String.fromCharCode(byte);
            return globalThis.btoa(binary);
          }),
        );
      const secret = yield* digest("secretsalt");
      const authentication = yield* digest(`${secret}challenge`);
      const sockets: Array<MockWebSocket> = [];
      const emitted: Array<ObsEvent.Any> = [];
      const eventReceived = yield* Deferred.make<void>();
      const refreshClient = vi.fn();
      const refreshResource = vi.fn();
      const setStorage = vi.fn();
      let storage: typeof OBSEngine.Storage.Type = { sockets: {} };

      const dependencies = Layer.mergeAll(
        Layer.succeed(Crypto.Crypto)(crypto),
        Layer.succeed(Socket.WebSocketConstructor)((url) => {
          const socket = new MockWebSocket(url);
          sockets.push(socket);
          return socket as unknown as globalThis.WebSocket;
        }),
        Layer.succeed(OBSEngine.EngineContext)({
          storage: {
            get: Effect.sync(() => storage),
            set: (value) =>
              Effect.sync(() => {
                storage = value;
                setStorage(value);
              }),
            update: (f) =>
              Effect.sync(() => {
                storage = f(storage);
                setStorage(storage);
              }),
          },
          resource: {
            refresh: (resource) => Effect.sync(() => refreshResource(resource)),
          },
          credentials: {
            get: Effect.succeed([]),
            refresh: () => Effect.die("OBS does not use credentials"),
            subscribe: () => Effect.void,
          },
          client: { refresh: Effect.sync(refreshClient) },
          emit: (event) =>
            Effect.sync(() => emitted.push(event)).pipe(
              Effect.andThen(Deferred.succeed(eventReceived, undefined)),
              Effect.asVoid,
            ),
        }),
      );

      yield* Effect.gen(function* () {
        const { client, engine, runtime } = yield* EngineTest.makeClients(OBSEngine);

        yield* client.AddSocket({
          address,
          name: "Studio OBS",
          password: "secret",
        });

        assert.strictEqual(sockets.length, 1);
        assert.strictEqual(sockets[0]?.url, address);
        assert.deepStrictEqual(sockets[0]?.sent[0], {
          op: 1,
          d: { rpcVersion: 1, eventSubscriptions: 0x7fffffff, authentication },
        });
        expect(setStorage).toHaveBeenCalledWith({
          sockets: {
            [address]: {
              name: "Studio OBS",
              password: "secret",
              connectOnStartup: true,
            },
          },
        });
        expect(refreshResource).toHaveBeenCalledWith(OBSSocket);

        const response = yield* runtime.Call({ address, requestType: "GetVersion" });
        assert.deepStrictEqual(response, { obsVersion: "31.0.0" });
        assert.deepStrictEqual(sockets[0]?.sent[1], {
          op: 6,
          d: {
            requestType: "GetVersion",
            requestId: sockets[0]?.sent[1]?.d.requestId,
          },
        });

        const requestError = yield* Effect.flip(runtime.Call({ address, requestType: "Fail" }));
        assert.strictEqual(requestError._tag, "RequestFailed");
        if (requestError._tag === "RequestFailed") {
          assert.strictEqual(requestError.requestType, "Fail");
          assert.strictEqual(requestError.code, 500);
          assert.strictEqual(requestError.comment, "Request failed");
        }

        sockets[0]?.emit("CurrentProgramSceneChanged", {
          sceneName: "Live",
          sceneUuid: "scene-1",
        });
        yield* Deferred.await(eventReceived);
        assert.deepStrictEqual(
          emitted.map((event) => ({ ...event })),
          [
            {
              _tag: "CurrentProgramSceneChanged",
              address,
              sceneName: "Live",
              sceneUuid: "scene-1",
            },
          ],
        );

        assert.deepStrictEqual(yield* engine.client.state, {
          sockets: [{ name: "Studio OBS", address, state: "connected" }],
        });

        yield* client.DisconnectSocket({ address });
        assert.deepStrictEqual(yield* engine.client.state, {
          sockets: [{ name: "Studio OBS", address, state: "disconnected" }],
        });

        yield* client.RemoveSocket({ address });
        assert.deepStrictEqual(yield* engine.client.state, { sockets: [] });
        expect(setStorage).toHaveBeenLastCalledWith({ sockets: {} });
        expect(refreshClient).toHaveBeenCalled();
      }).pipe(Effect.provide(deployment.layer.pipe(Layer.provide(dependencies))));
    }),
  );
});
