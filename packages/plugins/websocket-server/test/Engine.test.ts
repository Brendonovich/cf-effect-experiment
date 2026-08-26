import { assert, describe, it } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Deferred, Effect, Fiber, Layer, Result, Schema } from "effect";
import { createServer } from "node:net";

import {
  ClientId,
  MAX_MESSAGE_BYTES,
  RuntimeStorage,
  type MessageReceived,
  ServerId,
  WebSocketServer,
  WebSocketServerEngine,
} from "../src/Definition.ts";
import { localLayer } from "../src/Engine.ts";
import { Adapter, type Client, type Listener, ListenerError } from "../src/Listener.ts";
import nodeListenerLayer from "../src/Listener/Node.ts";

class MockClient implements Client {
  readonly sent: Array<string> = [];
  readonly closeSignal = Deferred.makeUnsafe<void>();
  readonly closed = Deferred.await(this.closeSignal);
  onMessage: ((message: unknown) => Effect.Effect<void>) | undefined;
  failSend = false;
  sendStarted: Deferred.Deferred<void> | undefined;
  sendRelease: Deferred.Deferred<void> | undefined;

  send = (message: string) =>
    this.failSend
      ? Effect.fail(new ListenerError({ reason: "mock send failed" }))
      : Effect.suspend(() => {
          const started = this.sendStarted;
          const release = this.sendRelease;
          const sent = this.sent;
          return Effect.gen(function* () {
            if (started !== undefined) yield* Deferred.succeed(started, undefined);
            if (release !== undefined) yield* Deferred.await(release);
            sent.push(message);
          });
        });

  run = (onMessage: (message: unknown) => Effect.Effect<void>) =>
    Effect.sync(() => void (this.onMessage = onMessage)).pipe(Effect.andThen(this.closed));

  message(message: unknown) {
    return this.onMessage?.(message) ?? Effect.void;
  }

  close() {
    return Deferred.succeed(this.closeSignal, undefined).pipe(Effect.asVoid);
  }
}

type MockListener = {
  readonly host: string;
  readonly port: number;
  active: boolean;
  onClient: ((client: Client) => Effect.Effect<void>) | undefined;
  readonly clients: Array<MockClient>;
};

const serverDefinition = (
  id: string,
  options?: Partial<{
    readonly name: string;
    readonly host: string;
    readonly port: number;
    readonly manuallyDisabled: boolean;
  }>,
) => ({
  id: ServerId.make(id),
  name: options?.name ?? "Primary",
  host: options?.host ?? "127.0.0.1",
  port: options?.port ?? 1890,
  manuallyDisabled: options?.manuallyDisabled ?? false,
});

const makeHarness = Effect.fnUntraced(function* (
  initialServers: typeof WebSocketServerEngine.Storage.Type.servers = [],
  options?: {
    readonly failPort?: number;
    readonly failListener?: boolean;
    readonly blockListen?: boolean;
  },
) {
  let storage: typeof WebSocketServerEngine.Storage.Type = { servers: initialServers };
  const listeners: Array<MockListener> = [];
  const events: Array<
    | {
        readonly _tag: "WebSocketServerClientConnected";
        readonly serverId: ServerId;
        readonly clientId: ClientId;
      }
    | {
        readonly _tag: "WebSocketServerClientDisconnected";
        readonly serverId: ServerId;
        readonly clientId: ClientId;
        readonly cause: "peer" | "server" | "error";
        readonly reason: string;
      }
    | MessageReceived
  > = [];
  let resourceRefreshes = 0;
  const adapter = Layer.succeed(Adapter, {
    listen: ({ host, port }) =>
      Effect.gen(function* () {
        if (
          port === options?.failPort ||
          listeners.some(
            (listener) => listener.active && listener.host === host && listener.port === port,
          )
        )
          return yield* new ListenerError({ reason: "address already in use" });
        const record: MockListener = {
          host,
          port,
          active: true,
          onClient: undefined,
          clients: [],
        };
        listeners.push(record);
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            record.active = false;
            for (const client of record.clients) yield* client.close();
          }),
        );
        if (options?.blockListen) yield* Effect.never;
        const listener: Listener = {
          run: (onClient) =>
            Effect.sync(() => void (record.onClient = onClient)).pipe(
              Effect.andThen(
                options?.failListener
                  ? Effect.fail(new ListenerError({ reason: "listener loop failed" }))
                  : Effect.never,
              ),
            ),
        };
        return listener;
      }),
  });
  const dependencies = Layer.succeed(WebSocketServerEngine.EngineContext)({
    storage: {
      get: Effect.sync(() => storage),
      set: (value) => Effect.sync(() => void (storage = value)),
      update: (update) => Effect.sync(() => void (storage = update(storage))),
    },
    resource: {
      refresh: () => Effect.sync(() => void resourceRefreshes++),
    },
    credentials: {
      get: Effect.succeed([]),
      refresh: () => Effect.die("unused"),
      subscribe: () => Effect.void,
    },
    client: { refresh: Effect.void },
    emit: (event) => Effect.sync(() => void events.push(event)),
  });
  const connect = Effect.fnUntraced(function* (listenerIndex = 0) {
    const listener = listeners[listenerIndex];
    if (listener === undefined) return yield* Effect.die("listener is not running");
    while (listener.onClient === undefined) yield* Effect.yieldNow;
    const client = new MockClient();
    listener.clients.push(client);
    const fiber = yield* listener.onClient(client).pipe(Effect.forkChild);
    return { client, fiber };
  });
  return {
    engineLayer: localLayer(adapter).pipe(Layer.provide(dependencies)),
    dependencies,
    listeners,
    events,
    connect,
    storage: () => storage,
    resourceRefreshes: () => resourceRefreshes,
  };
});

const waitFor = (predicate: () => boolean) =>
  Effect.gen(function* () {
    while (!predicate()) yield* Effect.yieldNow;
  });

const availablePort = Effect.callback<number, Error>((resume) => {
  const server = createServer();
  server.once("error", (error) => resume(Effect.fail(error)));
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address === null || typeof address === "string") {
      server.close();
      resume(Effect.fail(new Error("Could not allocate a loopback port")));
      return;
    }
    server.close((error) =>
      resume(error === undefined ? Effect.succeed(address.port) : Effect.fail(error)),
    );
  });
});

const assertPortAvailable = (port: number) =>
  Effect.callback<void, Error>((resume) => {
    const server = createServer();
    server.once("error", (error) => resume(Effect.fail(error)));
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => resume(error === undefined ? Effect.void : Effect.fail(error))),
    );
  });

describe("WebSocket server engine", () => {
  it.effect(
    "persists definitions and manages clients, events, sends, limits, and stale callbacks",
    () =>
      Effect.gen(function* () {
        const harness = yield* makeHarness();
        yield* Effect.gen(function* () {
          const { client, engine, runtime } = yield* EngineTest.makeClients(WebSocketServerEngine);
          const id = yield* client.WebSocketServerAdd({
            name: "  Primary  ",
            host: "127.0.0.1",
            port: 1890,
          });
          assert.deepStrictEqual(harness.storage().servers, [serverDefinition(id)]);
          assert.deepStrictEqual(
            yield* WebSocketServer.values.pipe(Effect.provide(engine.resources)),
            [{ id, display: "Primary" }],
          );

          yield* Effect.all([
            client.WebSocketServerStart({ id }),
            client.WebSocketServerStart({ id }),
          ]);
          assert.strictEqual(harness.listeners.length, 1);
          assert.strictEqual((yield* client.WebSocketServerStatus({ id })).status, "running");
          const first = yield* harness.connect();
          const second = yield* harness.connect();
          yield* waitFor(() => harness.events.length === 2);
          const firstId = harness.events[0]!.clientId;
          const secondId = harness.events[1]!.clientId;
          assert.strictEqual((yield* engine.client.state).servers[0]?.clientCount, 2);

          yield* first.client.message(new Uint8Array([1, 2, 3]));
          yield* first.client.message("\ud800");
          yield* first.client.message("x".repeat(MAX_MESSAGE_BYTES + 1));
          yield* first.client.message("hello");
          assert.deepStrictEqual(
            harness.events.map((event) => event._tag),
            [
              "WebSocketServerClientConnected",
              "WebSocketServerClientConnected",
              "WebSocketServerMessageReceived",
            ],
          );

          yield* runtime.WebSocketServerSendToClient({
            serverId: id,
            clientId: firstId,
            message: "one",
          });
          yield* runtime.WebSocketServerBroadcast({ serverId: id, message: "all" });
          assert.deepStrictEqual(first.client.sent, ["one", "all"]);
          assert.deepStrictEqual(second.client.sent, ["all"]);
          second.client.failSend = true;
          const failedSend = yield* Effect.result(
            runtime.WebSocketServerSendToClient({
              serverId: id,
              clientId: secondId,
              message: "fail",
            }),
          );
          assert.isTrue(Result.isFailure(failedSend));
          if (Result.isFailure(failedSend))
            assert.strictEqual(failedSend.failure._tag, "WebSocketServerSendFailed");
          second.client.failSend = false;

          const oversized = yield* Effect.result(
            runtime.WebSocketServerBroadcast({
              serverId: id,
              message: "é".repeat(MAX_MESSAGE_BYTES / 2 + 1),
            }),
          );
          assert.isTrue(Result.isFailure(oversized));
          if (Result.isFailure(oversized))
            assert.strictEqual(oversized.failure._tag, "WebSocketServerMessageTooLarge");
          const malformed = yield* Effect.result(
            runtime.WebSocketServerBroadcast({ serverId: id, message: "\ud800" }),
          );
          assert.isTrue(Result.isFailure(malformed));
          if (Result.isFailure(malformed))
            assert.strictEqual(malformed.failure._tag, "WebSocketServerSendFailed");

          yield* first.client.close();
          yield* Fiber.join(first.fiber);
          const peerDisconnect = harness.events.find(
            (event) =>
              event._tag === "WebSocketServerClientDisconnected" && event.clientId === firstId,
          );
          assert.propertyVal(peerDisconnect, "cause", "peer");
          assert.strictEqual((yield* engine.client.state).servers[0]?.clientCount, 1);
          const missing = yield* Effect.result(
            runtime.WebSocketServerSendToClient({
              serverId: id,
              clientId: firstId,
              message: "late",
            }),
          );
          assert.isTrue(Result.isFailure(missing));
          if (Result.isFailure(missing))
            assert.strictEqual(missing.failure._tag, "WebSocketServerClientNotFound");

          second.client.sendStarted = yield* Deferred.make<void>();
          second.client.sendRelease = yield* Deferred.make<void>();
          const racingSend = yield* Effect.result(
            runtime.WebSocketServerSendToClient({
              serverId: id,
              clientId: secondId,
              message: "racing",
            }),
          ).pipe(Effect.forkChild);
          yield* Deferred.await(second.client.sendStarted);
          yield* client.WebSocketServerStop({ id });
          assert.isTrue(harness.storage().servers[0]?.manuallyDisabled);
          const racingResult = yield* Fiber.join(racingSend);
          assert.isTrue(Result.isFailure(racingResult));
          if (Result.isFailure(racingResult))
            assert.strictEqual(racingResult.failure._tag, "WebSocketServerSendFailed");
          yield* second.client.message("stale");
          assert.strictEqual((yield* engine.client.state).servers[0]?.clientCount, 0);
          assert.strictEqual(
            harness.events.filter((event) => event._tag === "WebSocketServerMessageReceived")
              .length,
            1,
          );
          const serverDisconnect = harness.events.find(
            (event) =>
              event._tag === "WebSocketServerClientDisconnected" && event.clientId === secondId,
          );
          assert.propertyVal(serverDisconnect, "cause", "server");
          yield* Fiber.interrupt(second.fiber);

          yield* client.WebSocketServerUpdate({
            id,
            name: "Updated",
            host: "localhost",
            port: 1891,
            manuallyDisabled: true,
          });
          assert.deepStrictEqual(harness.storage().servers, [
            serverDefinition(id, {
              name: "Updated",
              host: "localhost",
              port: 1891,
              manuallyDisabled: true,
            }),
          ]);
          yield* client.WebSocketServerRemove({ id });
          assert.deepStrictEqual(harness.storage(), { servers: [] });
          assert.isAtLeast(harness.resourceRefreshes(), 1);
          assert.notStrictEqual(firstId, secondId);
        }).pipe(Effect.provide(harness.engineLayer));
      }),
  );

  it.effect(
    "starts enabled persisted listeners, skips manually disabled listeners, and reports conflicts",
    () =>
      Effect.gen(function* () {
        const startup = serverDefinition("startup", { port: 1900 });
        const disabled = serverDefinition("disabled", { manuallyDisabled: true, port: 1902 });
        const harness = yield* makeHarness([startup, disabled], { failPort: 1901 });
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { client, engine } = yield* EngineTest.makeClients(WebSocketServerEngine);
            assert.strictEqual((yield* engine.client.state).servers[0]?.status, "running");
            assert.strictEqual((yield* engine.client.state).servers[1]?.status, "stopped");
            assert.isTrue(harness.listeners[0]?.active);
            assert.strictEqual(harness.listeners.length, 1);
            yield* client.WebSocketServerStart({ id: disabled.id });
            assert.isFalse(harness.storage().servers[1]?.manuallyDisabled);
            yield* client.WebSocketServerStop({ id: disabled.id });
            assert.isTrue(harness.storage().servers[1]?.manuallyDisabled);
            const id = yield* client.WebSocketServerAdd({
              name: "Conflict",
              host: "127.0.0.1",
              port: 1901,
            });
            const conflict = yield* Effect.result(client.WebSocketServerStart({ id }));
            assert.isTrue(Result.isFailure(conflict));
            if (Result.isFailure(conflict))
              assert.strictEqual(conflict.failure._tag, "WebSocketServerStartFailed");
            assert.strictEqual((yield* client.WebSocketServerStatus({ id })).status, "error");

            const duplicate = yield* Effect.result(
              client.WebSocketServerAdd({
                name: "Duplicate",
                host: "0.0.0.0",
                port: 1900,
              }),
            );
            assert.isTrue(Result.isFailure(duplicate));
            if (Result.isFailure(duplicate))
              assert.strictEqual(duplicate.failure._tag, "WebSocketInvalidServer");
          }).pipe(Effect.provide(harness.engineLayer)),
        );
        assert.isFalse(harness.listeners[0]?.active);
      }),
  );

  it.effect("decodes legacy storage defaults and rejects ambiguous bind addresses", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknownEffect(RuntimeStorage)({
        servers: [{ id: "legacy", name: "Legacy" }],
      });
      assert.deepStrictEqual(decoded.servers, [
        serverDefinition("legacy", { name: "Legacy", host: "127.0.0.1", port: 1890 }),
      ]);

      const harness = yield* makeHarness();
      yield* Effect.gen(function* () {
        const { client } = yield* EngineTest.makeClients(WebSocketServerEngine);
        for (const host of ["999.1.1.1", "-invalid.local", "[::1", "a..b"]) {
          const result = yield* Effect.result(
            client.WebSocketServerAdd({ name: host, host, port: 1990 }),
          );
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result))
            assert.strictEqual(result.failure._tag, "WebSocketInvalidServer");
        }
        const ipv6 = yield* client.WebSocketServerAdd({
          name: "IPv6",
          host: "[::1]",
          port: 1990,
        });
        assert.strictEqual(
          (yield* client.WebSocketServerStatus({ id: ipv6 })).definition.host,
          "::1",
        );
      }).pipe(Effect.provide(harness.engineLayer));
    }),
  );

  it.effect("closes and marks a listener that fails after binding", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([], { failListener: true });
      yield* Effect.gen(function* () {
        const { client } = yield* EngineTest.makeClients(WebSocketServerEngine);
        const id = yield* client.WebSocketServerAdd({
          name: "Failing",
          host: "127.0.0.1",
          port: 1991,
        });
        yield* client.WebSocketServerStart({ id });
        yield* waitFor(() => !harness.listeners[0]!.active);
        const status = yield* client.WebSocketServerStatus({ id });
        assert.strictEqual(status.status, "error");
        assert.strictEqual(status.error, "listener loop failed");
      }).pipe(Effect.provide(harness.engineLayer));
    }),
  );

  it.effect("cleans up an interrupted listener acquisition", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness([], { blockListen: true });
      yield* Effect.gen(function* () {
        const { client } = yield* EngineTest.makeClients(WebSocketServerEngine);
        const id = yield* client.WebSocketServerAdd({
          name: "Interrupted",
          host: "127.0.0.1",
          port: 1992,
        });
        const start = yield* client.WebSocketServerStart({ id }).pipe(Effect.forkChild);
        yield* waitFor(() => harness.listeners.length === 1);
        yield* Fiber.interrupt(start);
        assert.isFalse(harness.listeners[0]!.active);
        assert.strictEqual((yield* client.WebSocketServerStatus({ id })).status, "stopped");
      }).pipe(Effect.provide(harness.engineLayer));
    }),
  );

});

describe("Node WebSocket listener", () => {
  it.effect("accepts a real loopback client and exchanges text", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const port = yield* availablePort;
      const liveLayer = localLayer(nodeListenerLayer).pipe(Layer.provide(harness.dependencies));
      yield* Effect.scoped(
        Effect.gen(function* () {
          const { client, runtime } = yield* EngineTest.makeClients(WebSocketServerEngine);
          const id = yield* client.WebSocketServerAdd({
            name: "Loopback",
            host: "127.0.0.1",
            port,
          });
          yield* client.WebSocketServerStart({ id });
          const opened = yield* Deferred.make<void>();
          const received = yield* Deferred.make<string>();
          const socket = new WebSocket(`ws://127.0.0.1:${port}`);
          socket.addEventListener("open", () => Deferred.doneUnsafe(opened, Effect.void));
          socket.addEventListener("message", (event) =>
            Deferred.doneUnsafe(received, Effect.succeed(String(event.data))),
          );
          yield* Deferred.await(opened);
          yield* waitFor(() =>
            harness.events.some((event) => event._tag === "WebSocketServerClientConnected"),
          );
          socket.send("loopback-in");
          yield* waitFor(() =>
            harness.events.some(
              (event) =>
                event._tag === "WebSocketServerMessageReceived" && event.message === "loopback-in",
            ),
          );
          yield* runtime.WebSocketServerBroadcast({ serverId: id, message: "loopback-out" });
          assert.strictEqual(yield* Deferred.await(received), "loopback-out");
          socket.close();
        }).pipe(Effect.provide(liveLayer)),
      );
      yield* assertPortAvailable(port);
    }),
  );

  it.effect("reports an external port conflict as a typed start failure", () =>
    Effect.gen(function* () {
      const port = yield* availablePort;
      yield* Effect.scoped(
        Effect.gen(function* () {
          const occupied = createServer();
          yield* Effect.callback<void, Error>((resume) => {
            occupied.once("error", (error) => resume(Effect.fail(error)));
            occupied.listen(port, "127.0.0.1", () => resume(Effect.void));
          });
          yield* Effect.addFinalizer(() =>
            Effect.callback<void>((resume) => {
              occupied.close(() => resume(Effect.void));
            }),
          );
          const harness = yield* makeHarness();
          const liveLayer = localLayer(nodeListenerLayer).pipe(Layer.provide(harness.dependencies));
          yield* Effect.gen(function* () {
            const { client } = yield* EngineTest.makeClients(WebSocketServerEngine);
            const id = yield* client.WebSocketServerAdd({
              name: "Occupied",
              host: "127.0.0.1",
              port,
            });
            const result = yield* Effect.result(client.WebSocketServerStart({ id }));
            assert.isTrue(Result.isFailure(result));
            if (Result.isFailure(result))
              assert.strictEqual(result.failure._tag, "WebSocketServerStartFailed");
          }).pipe(Effect.provide(liveLayer));
        }),
      );
      yield* assertPortAvailable(port);
    }),
  );
});
