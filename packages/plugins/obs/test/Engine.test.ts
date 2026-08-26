import { assert, describe, expect, it, vi } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Crypto, Deferred, Effect, Fiber, Layer, Result, Schema } from "effect";
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
    if (!url.endsWith("/pending")) queueMicrotask(() => this.identify());
  }

  identify() {
    this.message({
      op: 0,
      d: {
        obsWebSocketVersion: "5.5.2",
        rpcVersion: 1,
        authentication: { challenge: "challenge", salt: "salt" },
      },
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
      const failed = packet.d.requestType === "Fail" || packet.d.requestType === "FailSecret";
      queueMicrotask(() =>
        this.message({
          op: 7,
          d: {
            requestType: packet.d.requestType,
            requestId: packet.d.requestId,
            requestStatus: failed
              ? {
                  result: false,
                  code: 500,
                  comment:
                    packet.d.requestType === "FailSecret"
                      ? "secret at ws://user:secret@example.com"
                      : "Request failed",
                }
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
  it("decodes passwords and storage written while passwords were external", () => {
    const address = SocketAddress.make("ws://localhost:4455");
    assert.deepStrictEqual(
      Schema.decodeUnknownSync(OBSEngine.Storage)({
        sockets: {
          [address]: {
            name: "Legacy OBS",
            password: "legacy-secret",
            connectOnStartup: true,
          },
        },
      }),
      {
        sockets: {
          [address]: {
            name: "Legacy OBS",
            password: "legacy-secret",
            connectOnStartup: true,
          },
        },
      },
    );
    assert.deepStrictEqual(
      Schema.decodeUnknownSync(OBSEngine.Storage)({
        sockets: { [address]: { name: "External password era", connectOnStartup: false } },
      }),
      {
        sockets: { [address]: { name: "External password era", connectOnStartup: false } },
      },
    );
  });

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
      let storage: typeof OBSEngine.Storage.Type = {
        sockets: {
          [address]: {
            name: "Existing Cloud OBS",
            connectOnStartup: false,
          },
        },
      };

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

        const response = yield* runtime.Call({
          address,
          requestType: "GetVersion",
        });
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

        const redactedError = yield* Effect.flip(
          runtime.Call({ address, requestType: "FailSecret" }),
        );
        assert.strictEqual(redactedError._tag, "RequestFailed");
        if (redactedError._tag === "RequestFailed") {
          assert.notInclude(redactedError.comment ?? "", "secret");
          assert.include(redactedError.comment ?? "", "[redacted]");
        }

        const invalidAddress = SocketAddress.make("ws://user:address-secret@localhost:4455");
        const invalid = yield* Effect.flip(
          client.AddSocket({
            address: invalidAddress,
            password: "password-secret",
          }),
        );
        assert.strictEqual(invalid._tag, "ConnectionFailed");
        if (invalid._tag === "ConnectionFailed") {
          assert.notInclude(invalid.reason, "address-secret");
          assert.notInclude(invalid.reason, "password-secret");
        }
        assert.strictEqual(sockets.length, 1);

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
        sockets[0]?.emit("FutureOBSProtocolEvent", { secret: "ignored" });
        yield* Effect.yieldNow;
        assert.strictEqual(emitted.length, 1);

        assert.deepStrictEqual(yield* engine.client.state, {
          sockets: [
            {
              name: "Studio OBS",
              address,
              connectOnStartup: true,
              state: "connected",
            },
          ],
        });

        yield* client.DisconnectSocket({ address });
        assert.deepStrictEqual(yield* engine.client.state, {
          sockets: [
            {
              name: "Studio OBS",
              address,
              connectOnStartup: true,
              state: "disconnected",
            },
          ],
        });

        const editedAddress = SocketAddress.make("ws://localhost:4456");
        yield* client.UpdateSocket({
          currentAddress: address,
          address: editedAddress,
          name: "Edited OBS",
          connectOnStartup: false,
        });
        assert.deepStrictEqual(yield* engine.client.state, {
          sockets: [
            {
              name: "Edited OBS",
              address: editedAddress,
              connectOnStartup: false,
              state: "disconnected",
            },
          ],
        });
        expect(setStorage).toHaveBeenLastCalledWith({
          sockets: {
            [editedAddress]: {
              name: "Edited OBS",
              password: "secret",
              connectOnStartup: false,
            },
          },
        });

        yield* client.RemoveSocket({ address: editedAddress });
        assert.deepStrictEqual(yield* engine.client.state, { sockets: [] });
        expect(setStorage).toHaveBeenLastCalledWith({ sockets: {} });
        expect(refreshClient).toHaveBeenCalled();
      }).pipe(Effect.provide(deployment.layer.pipe(Layer.provide(dependencies))));

      storage = {
        sockets: {
          [address]: {
            name: "Reloaded OBS",
            password: "secret",
            connectOnStartup: true,
          },
        },
      };
      yield* Effect.gen(function* () {
        const { client, engine } = yield* EngineTest.makeClients(OBSEngine);
        while (sockets.length < 2) yield* Effect.yieldNow;
        while ((yield* engine.client.state).sockets[0]?.state !== "connected") {
          yield* Effect.yieldNow;
        }
        assert.deepStrictEqual(sockets[1]?.sent[0], {
          op: 1,
          d: { rpcVersion: 1, eventSubscriptions: 0x7fffffff, authentication },
        });
        assert.deepStrictEqual(yield* engine.client.state, {
          sockets: [
            {
              address,
              name: "Reloaded OBS",
              connectOnStartup: true,
              state: "connected",
            },
          ],
        });
        yield* client.RemoveSocket({ address });
      }).pipe(Effect.provide(deployment.layer.pipe(Layer.provide(dependencies))));

      const pendingAddress = SocketAddress.make("ws://localhost:4457/pending");
      storage = {
        sockets: {
          [pendingAddress]: { connectOnStartup: false },
        },
      };
      yield* Effect.gen(function* () {
        const { client, engine } = yield* EngineTest.makeClients(OBSEngine);
        const connecting = yield* client
          .ConnectSocket({ address: pendingAddress })
          .pipe(Effect.forkChild);
        while (sockets.length < 3) yield* Effect.yieldNow;
        assert.strictEqual((yield* engine.client.state).sockets[0]?.state, "connecting");
        yield* client.RemoveSocket({ address: pendingAddress });
        assert.isTrue(Result.isFailure(yield* Effect.result(Fiber.join(connecting))));
        sockets[2]?.identify();
        yield* Effect.yieldNow;
        assert.deepStrictEqual(yield* engine.client.state, { sockets: [] });
      }).pipe(Effect.provide(deployment.layer.pipe(Layer.provide(dependencies))));
    }),
  );

});
