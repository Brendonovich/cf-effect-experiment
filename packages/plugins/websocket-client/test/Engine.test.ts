import { assert, describe, it } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Deferred, Effect, Fiber, Layer, Result, Schema } from "effect";
import { Socket } from "effect/unstable/socket";

import {
  ConnectionId,
  MAX_MESSAGE_BYTES,
  type MessageReceived,
  WebSocketClientEngine,
  WebSocketConnection,
} from "../src/Definition.ts";
import { localLayer, productionLayer } from "../src/Engine.ts";

class MockWebSocket extends EventTarget {
  readyState = 0;
  readonly sent: Array<string> = [];
  closed = false;
  failSend = false;
  closeEventPending = false;

  constructor(
    readonly url: string,
    autoOpen: boolean,
    readonly deferCloseEvent: boolean,
  ) {
    super();
    if (autoOpen) queueMicrotask(() => this.open());
  }

  open() {
    if (this.closed) return;
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (this.failSend) throw new Error("send failed");
    if (typeof data !== "string") throw new Error("expected text");
    this.sent.push(data);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    if (this.deferCloseEvent) this.closeEventPending = true;
    else this.dispatchEvent(new Event("close"));
  }

  flushClose() {
    if (!this.closeEventPending) return;
    this.closeEventPending = false;
    this.dispatchEvent(new Event("close"));
  }

  message(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  fail() {
    this.dispatchEvent(new Event("error"));
  }
}

const definition = (
  id: string,
  overrides?: Partial<{
    readonly name: string;
    readonly url: string;
    readonly connectOnStartup: boolean;
  }>,
) => ({
  id: ConnectionId.make(id),
  name: overrides?.name ?? "Primary",
  url: overrides?.url ?? "ws://localhost:8080/socket",
  connectOnStartup: overrides?.connectOnStartup ?? false,
});

const makeHarness = Effect.fnUntraced(function* (
  initialConnections: typeof WebSocketClientEngine.Storage.Type.connections = [],
  options?: {
    readonly autoOpen?: boolean;
    readonly hosted?: boolean;
    readonly deferCloseEvent?: boolean;
  },
) {
  let storage: typeof WebSocketClientEngine.Storage.Type = {
    connections: initialConnections,
  };
  const sockets: Array<MockWebSocket> = [];
  const emitted: Array<MessageReceived> = [];
  let clientRefreshes = 0;
  let resourceRefreshes = 0;
  const created = yield* Deferred.make<void>();
  const messageEmitted = yield* Deferred.make<void>();
  const dependencies = Layer.mergeAll(
    Layer.succeed(Socket.WebSocketConstructor)((url) => {
      const socket = new MockWebSocket(
        url,
        options?.autoOpen !== false,
        options?.deferCloseEvent === true,
      );
      sockets.push(socket);
      Deferred.doneUnsafe(created, Effect.void);
      return socket as unknown as globalThis.WebSocket;
    }),
    Layer.succeed(WebSocketClientEngine.EngineContext)({
      storage: {
        get: Effect.sync(() => storage),
        set: (value) =>
          Effect.sync(() => {
            storage = value;
          }),
        update: (update) =>
          Effect.sync(() => {
            storage = update(storage);
          }),
      },
      resource: {
        refresh: () =>
          Effect.sync(() => {
            resourceRefreshes++;
          }),
      },
      credentials: {
        get: Effect.succeed([]),
        refresh: () => Effect.die("WebSocket client does not use credentials"),
        subscribe: () => Effect.void,
      },
      client: {
        refresh: Effect.sync(() => {
          clientRefreshes++;
        }),
      },
      emit: (event) =>
        Effect.sync(() => {
          emitted.push(event);
          Deferred.doneUnsafe(messageEmitted, Effect.void);
        }),
    }),
  );
  const engineLayer = (options?.hosted ? productionLayer : localLayer).pipe(
    Layer.provide(dependencies),
  );
  return {
    engineLayer,
    sockets,
    emitted,
    created,
    messageEmitted,
    storage: () => storage,
    clientRefreshes: () => clientRefreshes,
    resourceRefreshes: () => resourceRefreshes,
  };
});

describe("WebSocket client engine", () => {
  it.effect(
    "persists definitions, exposes resources, and manages message lifecycle",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* Effect.gen(function* () {
          const { client, engine, runtime } = yield* EngineTest.makeClients(
            WebSocketClientEngine,
          );
          const id = yield* client.WebSocketAddConnection({
            name: "  Primary  ",
            url: "ws://localhost:8080/socket",
          });

          assert.deepStrictEqual(harness.storage().connections, [
            definition(id, {
              name: "Primary",
            }),
          ]);
          assert.deepStrictEqual(
            yield* WebSocketConnection.values.pipe(
              Effect.provide(engine.resources),
            ),
            [{ id, display: "Primary" }],
          );

          yield* client.WebSocketConnect({ id });
          assert.isTrue(harness.storage().connections[0]?.connectOnStartup);
          assert.strictEqual(harness.sockets.length, 1);
          assert.strictEqual(
            (yield* engine.client.state).connections[0]?.status,
            "connected",
          );

          yield* runtime.WebSocketSendMessage({
            connectionId: id,
            data: "hello",
          });
          assert.deepStrictEqual(harness.sockets[0]?.sent, ["hello"]);

          const utf8Limit = "é".repeat(MAX_MESSAGE_BYTES / 2);
          yield* runtime.WebSocketSendMessage({
            connectionId: id,
            data: utf8Limit,
          });
          assert.strictEqual(harness.sockets[0]?.sent[1], utf8Limit);

          harness.sockets[0]?.message(new Uint8Array([1, 2, 3]));
          harness.sockets[0]?.message("x".repeat(MAX_MESSAGE_BYTES + 1));
          harness.sockets[0]?.message("received");
          yield* Deferred.await(harness.messageEmitted);
          assert.deepStrictEqual(
            harness.emitted.map((event) => ({ ...event })),
            [
              {
                _tag: "WebSocketMessageReceived",
                connectionId: id,
                data: "received",
              },
            ],
          );

          yield* client.WebSocketUpdateConnection({
            id,
            name: "Updated",
            url: "ws://localhost:8081/updated",
            connectOnStartup: false,
          });
          assert.isTrue(harness.sockets[0]?.closed);
          assert.deepStrictEqual(harness.storage().connections, [
            definition(id, {
              name: "Updated",
              url: "ws://localhost:8081/updated",
            }),
          ]);
          assert.deepStrictEqual((yield* engine.client.state).connections[0], {
            definition: definition(id, {
              name: "Updated",
              url: "ws://localhost:8081/updated",
            }),
            status: "disconnected",
          });
          yield* client.WebSocketConnect({ id });
          yield* client.WebSocketDisconnect({ id });
          assert.isFalse(harness.storage().connections[0]?.connectOnStartup);
          assert.isTrue(harness.sockets[1]?.closed);
          yield* client.WebSocketRemoveConnection({ id });
          assert.deepStrictEqual(harness.storage(), { connections: [] });
          assert.deepStrictEqual(yield* engine.client.state, {
            connections: [],
          });
          assert.isAtLeast(harness.clientRefreshes(), 1);
          assert.strictEqual(harness.resourceRefreshes(), 3);
        }).pipe(Effect.provide(harness.engineLayer));
      }),
  );

  it.effect(
    "validates URL fields without exposing credentials",
    () =>
      Effect.gen(function* () {
        const local = yield* makeHarness();
        yield* Effect.gen(function* () {
          const { client } = yield* EngineTest.makeClients(
            WebSocketClientEngine,
          );
          for (const input of [
            { name: "", url: "ws://localhost" },
            { name: "test", url: "not a url" },
            { name: "test", url: "https://example.com" },
            { name: "test", url: "ws://user:secret@localhost" },
          ]) {
            const result = yield* Effect.result(
              client.WebSocketAddConnection({
                ...input,
              }),
            );
            assert.isTrue(Result.isFailure(result));
            if (Result.isFailure(result)) {
              assert.strictEqual(
                result.failure._tag,
                "WebSocketInvalidConnection",
              );
              assert.notInclude(result.failure.reason, "secret");
            }
          }
        }).pipe(Effect.provide(local.engineLayer));

        const legacy = yield* makeHarness([
          definition("legacy", { url: "ws://user:secret@localhost/socket" }),
        ]);
        yield* Effect.gen(function* () {
          const { engine } = yield* EngineTest.makeClients(
            WebSocketClientEngine,
          );
          const loaded = (yield* engine.client.state).connections[0];
          assert.strictEqual(loaded?.status, "error");
          assert.notInclude(loaded?.definition.url ?? "", "user");
          assert.notInclude(loaded?.definition.url ?? "", "secret");
        }).pipe(Effect.provide(legacy.engineLayer));

        const hosted = yield* makeHarness([], { hosted: true });
        yield* Effect.gen(function* () {
          const { client } = yield* EngineTest.makeClients(
            WebSocketClientEngine,
          );
          for (const url of [
            "ws://example.com",
            "wss://localhost",
            "wss://127.0.0.1",
            "wss://2130706433",
            "wss://192.88.99.1",
            "wss://[::1]",
            "wss://[::ffff:127.0.0.1]",
            "wss://example.com:8443",
          ]) {
            assert.isTrue(
              Result.isFailure(
                yield* Effect.result(
                  client.WebSocketAddConnection({
                    name: "Hosted",
                    url,
                  }),
                ),
              ),
            );
          }
          yield* client.WebSocketAddConnection({
            name: "Hosted",
            url: "wss://example.com/socket",
          });
        }).pipe(Effect.provide(hosted.engineLayer));
      }),
  );

  it.effect(
    "decodes persisted connections from before optional fields were added",
    () =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeUnknownEffect(
          WebSocketClientEngine.Storage,
        )({
          connections: [
            {
              id: "legacy",
              name: "Legacy",
              url: "ws://localhost:8080",
            },
          ],
        });
        assert.deepStrictEqual(decoded.connections, [
          definition("legacy", {
            name: "Legacy",
            url: "ws://localhost:8080",
          }),
        ]);
      }),
  );

  it.effect(
    "drops callbacks from a socket after its definition is replaced",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness([], { deferCloseEvent: true });
        yield* Effect.gen(function* () {
          const { client } = yield* EngineTest.makeClients(
            WebSocketClientEngine,
          );
          const id = yield* client.WebSocketAddConnection({
            name: "Original",
            url: "ws://localhost:8080",
          });
          yield* client.WebSocketConnect({ id });
          yield* client.WebSocketUpdateConnection({
            id,
            name: "Replacement",
            url: "ws://localhost:8081",
            connectOnStartup: false,
          });

          harness.sockets[0]?.message("stale");
          yield* Effect.yieldNow;
          assert.deepStrictEqual(harness.emitted, []);
          harness.sockets[0]?.flushClose();
        }).pipe(Effect.provide(harness.engineLayer));
      }),
  );

  it.effect(
    "cancels in-flight connections without allowing stale completion",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness([], { autoOpen: false });
        yield* Effect.gen(function* () {
          const { client, engine } = yield* EngineTest.makeClients(
            WebSocketClientEngine,
          );
          const id = yield* client.WebSocketAddConnection({
            name: "Race",
            url: "ws://localhost:8080",
          });
          const connecting = yield* client
            .WebSocketConnect({ id })
            .pipe(Effect.forkChild);
          yield* Deferred.await(harness.created);
          yield* Effect.yieldNow;
          yield* client.WebSocketDisconnect({ id });
          assert.isTrue(
            Result.isFailure(yield* Effect.result(Fiber.join(connecting))),
          );
          harness.sockets[0]?.open();
          yield* Effect.yieldNow;
          assert.strictEqual(
            (yield* engine.client.state).connections[0]?.status,
            "disconnected",
          );

          const reconnecting = yield* client
            .WebSocketConnect({ id })
            .pipe(Effect.forkChild);
          while (harness.sockets.length < 2) yield* Effect.yieldNow;
          yield* client.WebSocketRemoveConnection({ id });
          assert.isTrue(
            Result.isFailure(yield* Effect.result(Fiber.join(reconnecting))),
          );
          harness.sockets[1]?.open();
          assert.deepStrictEqual(yield* engine.client.state, {
            connections: [],
          });

          const updateId = yield* client.WebSocketAddConnection({
            name: "Before",
            url: "ws://localhost:8080",
          });
          const updating = yield* client
            .WebSocketConnect({ id: updateId })
            .pipe(Effect.forkChild);
          while (harness.sockets.length < 3) yield* Effect.yieldNow;
          yield* client.WebSocketUpdateConnection({
            id: updateId,
            name: "After",
            url: "ws://localhost:8081",
            connectOnStartup: false,
          });
          assert.isTrue(
            Result.isFailure(yield* Effect.result(Fiber.join(updating))),
          );
          harness.sockets[2]?.open();
          assert.deepStrictEqual(
            (yield* engine.client.state).connections[0],
            {
              definition: definition(updateId, {
                name: "After",
                url: "ws://localhost:8081/",
              }),
              status: "disconnected",
            },
          );

          const missing = ConnectionId.make("missing");
          assert.isTrue(
            Result.isFailure(
              yield* Effect.result(
                client.WebSocketRemoveConnection({ id: missing }),
              ),
            ),
          );
        }).pipe(Effect.provide(harness.engineLayer));
      }),
  );

  it.effect("reports connection, send, and size failures as typed errors", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([], { autoOpen: false });
      yield* Effect.gen(function* () {
        const { client, runtime } = yield* EngineTest.makeClients(
          WebSocketClientEngine,
        );
        const id = yield* client.WebSocketAddConnection({
          name: "Failures",
          url: "ws://localhost:8080",
        });
        const connecting = yield* client
          .WebSocketConnect({ id })
          .pipe(Effect.forkChild);
        yield* Deferred.await(harness.created);
        yield* Effect.yieldNow;
        harness.sockets[0]?.fail();
        const failedConnection = yield* Effect.result(Fiber.join(connecting));
        assert.isTrue(Result.isFailure(failedConnection));
        if (Result.isFailure(failedConnection))
          assert.strictEqual(
            failedConnection.failure._tag,
            "WebSocketConnectionFailed",
          );
        assert.isTrue(harness.storage().connections[0]?.connectOnStartup);

        const notConnected = yield* Effect.result(
          runtime.WebSocketSendMessage({ connectionId: id, data: "hello" }),
        );
        assert.isTrue(Result.isFailure(notConnected));
        if (Result.isFailure(notConnected))
          assert.strictEqual(
            notConnected.failure._tag,
            "WebSocketNotConnected",
          );

        const oversized = yield* Effect.result(
          runtime.WebSocketSendMessage({
            connectionId: id,
            data: "é".repeat(MAX_MESSAGE_BYTES / 2 + 1),
          }),
        );
        assert.isTrue(Result.isFailure(oversized));
        if (Result.isFailure(oversized))
          assert.strictEqual(
            oversized.failure._tag,
            "WebSocketMessageTooLarge",
          );
      }).pipe(Effect.provide(harness.engineLayer));

      const sendHarness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const { client, runtime } = yield* EngineTest.makeClients(
          WebSocketClientEngine,
        );
        const id = yield* client.WebSocketAddConnection({
          name: "Writer",
          url: "ws://localhost:8080",
        });
        yield* client.WebSocketConnect({ id });
        sendHarness.sockets[0]!.failSend = true;
        const failedSend = yield* Effect.result(
          runtime.WebSocketSendMessage({ connectionId: id, data: "hello" }),
        );
        assert.isTrue(Result.isFailure(failedSend));
        if (Result.isFailure(failedSend))
          assert.strictEqual(failedSend.failure._tag, "WebSocketSendFailed");

        sendHarness.sockets[0]?.close();
        const closedSend = yield* Effect.result(
          runtime.WebSocketSendMessage({
            connectionId: id,
            data: "after close",
          }),
        );
        assert.isTrue(Result.isFailure(closedSend));
        if (Result.isFailure(closedSend))
          assert.isTrue(
            closedSend.failure._tag === "WebSocketSendFailed" ||
              closedSend.failure._tag === "WebSocketNotConnected",
          );
      }).pipe(Effect.provide(sendHarness.engineLayer));
    }),
  );

  it.effect(
    "connects startup definitions and closes their sockets with engine scope",
    () =>
      Effect.gen(function* () {
        const startup = definition("startup", { connectOnStartup: true });
        const harness = yield* makeHarness([startup]);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { engine } = yield* EngineTest.makeClients(
              WebSocketClientEngine,
            );
            yield* Deferred.await(harness.created);
            while (
              (yield* engine.client.state).connections[0]?.status !==
              "connected"
            ) {
              yield* Effect.yieldNow;
            }
            assert.strictEqual(harness.sockets.length, 1);
          }).pipe(Effect.provide(harness.engineLayer)),
        );
        assert.isTrue(harness.sockets[0]?.closed);
      }),
  );

});
