import { assert, describe, expect, it, vi } from "@effect/vitest";
import { EngineTest, Registration } from "@macrograph/plugin";
import { Crypto, Deferred, Effect, Fiber, Layer, Result, Schema, Stream } from "effect";
import { Socket } from "effect/unstable/socket";

import type * as ObsEvent from "../src/Events.ts";

import { OBSEngine, OBSSocket, SocketAddress } from "../src/Definition.ts";
import deployment from "../src/Deployment/WebSocket.ts";
import * as ObsWebSocket from "../src/ObsWebSocket.ts";
import OBSPlugin from "../src/Plugin.ts";
import {
  canvasRequests,
  highVolumeSubscriptions,
  supportsCanvases,
  type HighVolumeEvent,
} from "../src/Protocol.ts";

type Packet = {
  readonly op: number;
  readonly d: Record<string, unknown>;
};

class MockWebSocket extends EventTarget {
  readonly readyState = 1;
  readonly sent: Array<Packet> = [];

  constructor(
    readonly url: string,
    readonly version = "5.5.2",
    readonly rpcVersion = 1,
    readonly negotiatedRpcVersion = 1,
  ) {
    super();
    if (!url.endsWith("/pending")) queueMicrotask(() => this.identify());
  }

  identify() {
    this.message({
      op: 0,
      d: {
        obsWebSocketVersion: this.version,
        rpcVersion: this.rpcVersion,
        authentication: { challenge: "challenge", salt: "salt" },
      },
    });
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (typeof data !== "string") throw new Error("Expected a text WebSocket frame");
    const packet = JSON.parse(data) as Packet;
    this.sent.push(packet);

    if (packet.op === 1) {
      queueMicrotask(() =>
        this.message({ op: 2, d: { negotiatedRpcVersion: this.negotiatedRpcVersion } }),
      );
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
  it("requires a known stable canvas protocol version", () => {
    for (const version of [
      "5.0.0",
      "5.5.2",
      "5.6.99",
      "5.7.0-beta1",
      "unknown",
      "5.7",
      "garbage5.7.0",
    ])
      assert.isFalse(supportsCanvases(version), version);
    for (const version of ["5.7.0", "5.7.1", "5.10.0", "6.0.0", "5.7.0+build.1"])
      assert.isTrue(supportsCanvases(version), version);
  });

  it.effect("uses version-aware subscriptions and refuses unsupported canvas wire payloads", () =>
    Effect.gen(function* () {
      for (const [version, supported] of [
        ["5.5.2", false],
        ["5.6.99", false],
        ["5.7.0-beta1", false],
        ["unknown", false],
        ["5.7.0", true],
        ["5.10.0", true],
      ] as const) {
        let socket: MockWebSocket | undefined;
        let opened = 0;
        const dependencies = Layer.mergeAll(
          Layer.succeed(Crypto.Crypto)(
            Crypto.make({
              randomBytes: (size) => new Uint8Array(size),
              digest: (_algorithm, data) => Effect.succeed(data),
            }),
          ),
          Layer.succeed(Socket.WebSocketConstructor)((url) => {
            socket = new MockWebSocket(url, version);
            return socket as unknown as globalThis.WebSocket;
          }),
        );
        yield* Effect.gen(function* () {
          const client = yield* ObsWebSocket.make("ws://localhost:4455", "secret", {
            onOpen: Effect.sync(() => {
              opened++;
            }),
          });
          assert.isDefined(socket);
          assert.strictEqual(opened, 1);
          assert.strictEqual(socket.sent[0]?.d.eventSubscriptions, supported ? 0xfff : 0x7ff);
          const list = yield* Effect.result(client.call("GetCanvasList"));
          assert.strictEqual(Result.isSuccess(list), supported);
          assert.strictEqual(
            socket.sent.some((packet) => packet.d.requestType === "GetCanvasList"),
            supported,
          );
          for (const requestType of canvasRequests) {
            const before = socket.sent.length;
            const result = yield* Effect.result(
              client.call(requestType, { canvasUuid: "portrait" }),
            );
            assert.strictEqual(Result.isSuccess(result), supported);
            assert.strictEqual(socket.sent.length - before, supported ? 1 : 0);
            if (supported)
              assert.deepStrictEqual(socket.sent.at(-1)?.d.requestData, { canvasUuid: "portrait" });
            else if (Result.isFailure(result)) {
              assert.strictEqual(result.failure._tag, "RequestError");
              if (result.failure._tag === "RequestError")
                assert.strictEqual(result.failure.code, 204);
            }
            yield* client.call(requestType, { canvasUuid: "", sceneName: "Default" });
            assert.deepStrictEqual(socket.sent.at(-1)?.d.requestData, { sceneName: "Default" });
          }
          const before = socket.sent.length;
          for (const data of [
            { canvasUuid: "portrait" },
            { canvasUuid: null },
            { canvasUuid: 1 },
          ]) {
            const error = yield* Effect.flip(client.call("SetInputVolume", data));
            assert.strictEqual(error._tag, "RequestError");
            if (error._tag === "RequestError") assert.strictEqual(error.code, 402);
          }
          assert.strictEqual(socket.sent.length, before);
          yield* client.call("GetSceneList", { canvasUuid: "" });
          assert.isFalse(Object.hasOwn(socket.sent.at(-1)?.d ?? {}, "requestData"));
          yield* client.disconnect;
        }).pipe(Effect.scoped, Effect.provide(dependencies));
      }
    }),
  );

  it.effect("opens once before authentication and negotiates only the supported RPC version", () =>
    Effect.gen(function* () {
      for (const [password, offered, negotiated, expectedError] of [
        [undefined, 1, 1, "AuthenticationError"],
        ["secret", 0, 1, "ProtocolError"],
        ["secret", 2, 2, "ProtocolError"],
        ["secret", 2, 1, undefined],
      ] as const) {
        let socket: MockWebSocket | undefined;
        let opened = 0;
        const dependencies = Layer.mergeAll(
          Layer.succeed(Crypto.Crypto)(
            Crypto.make({
              randomBytes: (size) => new Uint8Array(size),
              digest: (_algorithm, data) => Effect.succeed(data),
            }),
          ),
          Layer.succeed(Socket.WebSocketConstructor)((url) => {
            socket = new MockWebSocket(url, "5.7.0", offered, negotiated);
            return socket as unknown as globalThis.WebSocket;
          }),
        );
        yield* Effect.gen(function* () {
          const result = yield* Effect.result(
            ObsWebSocket.make("ws://localhost:4455", password, {
              onOpen: Effect.sync(() => {
                opened++;
                assert.strictEqual(socket?.sent.length, 0);
              }),
            }),
          );
          assert.strictEqual(opened, 1);
          if (Result.isFailure(result)) assert.strictEqual(result.failure._tag, expectedError);
          else {
            assert.isUndefined(expectedError);
            yield* result.success.disconnect;
          }
          if (password === undefined || offered === 0) assert.strictEqual(socket?.sent.length, 0);
          else assert.strictEqual(socket?.sent[0]?.d.rpcVersion, 1);
        }).pipe(Effect.scoped, Effect.provide(dependencies));
      }
    }),
  );

  it.effect(
    "only enables selected high-volume masks, bounds backlog, and keeps responses flowing",
    () =>
      Effect.gen(function* () {
        const cases: ReadonlyArray<ReadonlyArray<HighVolumeEvent>> = [
          [],
          ["InputActiveStateChanged"],
          ["InputShowStateChanged"],
          ["InputVolumeMeters"],
          ["SceneItemTransformChanged"],
          [
            "InputVolumeMeters",
            "InputActiveStateChanged",
            "InputShowStateChanged",
            "SceneItemTransformChanged",
          ],
        ];
        for (const highVolumeEvents of cases) {
          let socket: MockWebSocket | undefined;
          const dependencies = Layer.mergeAll(
            Layer.succeed(Crypto.Crypto)(
              Crypto.make({
                randomBytes: (size) => new Uint8Array(size),
                digest: (_algorithm, data) => Effect.succeed(data),
              }),
            ),
            Layer.succeed(Socket.WebSocketConstructor)((url) => {
              socket = new MockWebSocket(url, "5.7.0");
              return socket as unknown as globalThis.WebSocket;
            }),
          );
          yield* Effect.gen(function* () {
            const client = yield* ObsWebSocket.make("ws://localhost:4455", "secret", {
              highVolumeEvents,
            });
            assert.isDefined(socket);
            assert.strictEqual(
              socket.sent[0]?.d.eventSubscriptions,
              0xfff |
                highVolumeEvents.reduce((mask, event) => mask | highVolumeSubscriptions[event], 0),
            );
            const entered = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            const received: Array<ObsWebSocket.ObsEvent> = [];
            const drained = yield* Deferred.make<void>();
            const latest = yield* Deferred.make<void>();
            const consumer = yield* client.events.pipe(
              Stream.runForEach((event) =>
                Effect.gen(function* () {
                  received.push(event);
                  if (event.eventType === "CustomEvent") {
                    yield* Deferred.succeed(entered, undefined);
                    yield* Deferred.await(release);
                  }
                  if (event.eventType === "VendorEvent")
                    yield* Deferred.succeed(drained, undefined);
                  if (
                    event.eventType === highVolumeEvents.at(-1) &&
                    typeof event.eventData === "object" &&
                    event.eventData !== null &&
                    "index" in event.eventData &&
                    event.eventData.index === 199
                  )
                    yield* Deferred.succeed(latest, undefined);
                }),
              ),
              Effect.forkChild,
            );
            socket.emit("CustomEvent", {});
            yield* Deferred.await(entered);
            socket.emit("ConnectionOpened", {});
            for (let index = 0; index < 200; index++) {
              for (const event of Object.keys(highVolumeSubscriptions))
                socket.emit(event, { index });
              yield* Effect.yieldNow;
            }
            // Request processing cannot be suspended behind the blocked event consumer.
            assert.deepStrictEqual(yield* client.call("GetVersion"), { obsVersion: "31.0.0" });
            yield* Deferred.succeed(release, undefined);
            if (highVolumeEvents.length > 0) yield* Deferred.await(latest);
            socket.emit("VendorEvent", {});
            yield* Deferred.await(drained);
            const highVolume = received.filter((event) =>
              Object.hasOwn(highVolumeSubscriptions, event.eventType),
            );
            assert.isTrue(highVolume.length <= 66, `Unbounded backlog: ${highVolume.length}`);
            if (highVolumeEvents.length === 0) assert.strictEqual(highVolume.length, 0);
            else {
              assert.isAbove(highVolume.length, 0);
              assert.isTrue(
                highVolume.every((event) =>
                  highVolumeEvents.some((selected) => selected === event.eventType),
                ),
              );
              assert.isTrue(
                highVolume.some(
                  (event) =>
                    typeof event.eventData === "object" &&
                    event.eventData !== null &&
                    "index" in event.eventData &&
                    event.eventData.index === 199,
                ),
              );
            }
            assert.isFalse(received.some((event) => event.eventType === "ConnectionOpened"));
            yield* Fiber.interrupt(consumer);
            yield* client.disconnect;
          }).pipe(Effect.scoped, Effect.provide(dependencies));
        }
      }),
  );

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
      let version = "5.5.2";
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
          const socket = new MockWebSocket(url, version);
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
              Effect.andThen(
                event._tag === "CurrentProgramSceneChanged"
                  ? Deferred.succeed(eventReceived, undefined)
                  : Effect.void,
              ),
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
          d: { rpcVersion: 1, eventSubscriptions: 0x7ff, authentication },
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
            { _tag: "ConnectionOpened", address },
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
        assert.strictEqual(emitted.length, 2);

        const unsupported = yield* Effect.flip(
          runtime.Call({
            address,
            requestType: "CreateScene",
            requestData: { sceneName: "New", canvasUuid: "portrait" },
          }),
        );
        assert.strictEqual(unsupported._tag, "RequestFailed");
        if (unsupported._tag === "RequestFailed") {
          assert.strictEqual(unsupported.requestType, "CreateScene");
          assert.strictEqual(unsupported.code, 204);
          assert.include(unsupported.comment ?? "", "5.7.0");
        }
        assert.isFalse(sockets[0]?.sent.some((packet) => packet.d.requestType === "CreateScene"));

        const volume = (yield* Registration.collect(OBSPlugin.effect)).find(
          ({ id }) => id === "SetInputVolumeDb",
        );
        assert.isDefined(volume);
        yield* volume.run({
          input: (ref) => (ref.id === "inputName" ? "Mic" : -12.5),
          output: () => undefined,
          properties: { socket: address },
          event: undefined,
          engine: runtime,
          execution: {
            projectId: "project",
            graphId: "graph",
            eventNodeId: "event",
            traceId: "trace",
          },
          node: {
            nodeId: "node",
            kind: "exec",
            executionPath: "node",
            traceId: "trace",
            withSpan: (_name, effect) => effect,
          },
        });
        assert.strictEqual(sockets[0]?.sent.at(-1)?.d.requestType, "SetInputVolume");
        assert.deepStrictEqual(sockets[0]?.sent.at(-1)?.d.requestData, {
          inputName: "Mic",
          inputVolumeDb: -12.5,
        });

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
          highVolumeEvents: ["InputVolumeMeters"],
        });
        assert.deepStrictEqual(yield* engine.client.state, {
          sockets: [
            {
              name: "Edited OBS",
              address: editedAddress,
              connectOnStartup: false,
              highVolumeEvents: ["InputVolumeMeters"],
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
              highVolumeEvents: ["InputVolumeMeters"],
            },
          },
        });

        yield* client.RemoveSocket({ address: editedAddress });
        assert.deepStrictEqual(yield* engine.client.state, { sockets: [] });
        expect(setStorage).toHaveBeenLastCalledWith({ sockets: {} });
        expect(refreshClient).toHaveBeenCalled();
      }).pipe(Effect.provide(deployment.layer.pipe(Layer.provide(dependencies))));

      version = "5.7.0";
      storage = {
        sockets: {
          [address]: {
            name: "Reloaded OBS",
            password: "secret",
            connectOnStartup: true,
            highVolumeEvents: [
              "InputVolumeMeters",
              "InputActiveStateChanged",
              "InputShowStateChanged",
              "SceneItemTransformChanged",
            ],
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
          d: { rpcVersion: 1, eventSubscriptions: 0xf0fff, authentication },
        });
        assert.deepStrictEqual(yield* engine.client.state, {
          sockets: [
            {
              address,
              name: "Reloaded OBS",
              connectOnStartup: true,
              highVolumeEvents: [
                "InputVolumeMeters",
                "InputActiveStateChanged",
                "InputShowStateChanged",
                "SceneItemTransformChanged",
              ],
              state: "connected",
            },
          ],
        });
        const newEvents = [
          ["CanvasCreated", { canvasName: "Portrait", canvasUuid: "portrait" }],
          ["CanvasRemoved", { canvasName: "Portrait", canvasUuid: "portrait" }],
          [
            "CanvasNameChanged",
            { canvasName: "Portrait", oldCanvasName: "Old", canvasUuid: "portrait" },
          ],
          ["InputActiveStateChanged", { inputName: "Camera", videoActive: true }],
          ["InputShowStateChanged", { inputName: "Camera", videoShowing: true }],
          [
            "InputVolumeMeters",
            { inputs: [{ inputName: "Mic", inputLevelsMul: [[0.1, 0.2, 0.3]] }] },
          ],
          [
            "SceneItemTransformChanged",
            { sceneName: "Live", sceneItemId: 1, sceneItemTransform: { scaleX: 1.2 } },
          ],
        ] as const;
        for (const [eventType, eventData] of newEvents) {
          sockets[1]?.emit(eventType, eventData);
          while (!emitted.some((event) => event._tag === eventType)) yield* Effect.yieldNow;
        }
        yield* client.UpdateSocket({ currentAddress: address, address, connectOnStartup: false });
        assert.deepStrictEqual(storage.sockets[address]?.highVolumeEvents, [
          "InputVolumeMeters",
          "InputActiveStateChanged",
          "InputShowStateChanged",
          "SceneItemTransformChanged",
        ]);
        yield* client.UpdateSocket({
          currentAddress: address,
          address,
          connectOnStartup: false,
          highVolumeEvents: [],
        });
        assert.deepStrictEqual(storage.sockets[address]?.highVolumeEvents, []);
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
