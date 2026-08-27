import { assert, describe, it, vi } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Effect, Layer, Result } from "effect";

import { StreamlabsEngine, StreamlabsFailure, type StreamlabsEvent } from "../src/Definition.ts";
import { layer } from "../src/Engine.ts";
import { SocketFactory, type StreamlabsSocket } from "../src/Transport.ts";

class FakeSocket implements StreamlabsSocket {
  readonly listeners = new Map<string, (payload: unknown) => void>();
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
  on(event: string, listener: (payload: unknown) => void) {
    this.listeners.set(event, listener);
  }
  off(event: string, listener: (payload: unknown) => void) {
    if (this.listeners.get(event) === listener) this.listeners.delete(event);
  }
  emit(event: string, payload: unknown = undefined) {
    this.listeners.get(event)?.(payload);
  }
}

function harness(initial: typeof StreamlabsEngine.Storage.Type = { token: "", enabled: false }) {
  let storage = initial;
  let storageDefect: unknown;
  const sockets: FakeSocket[] = [];
  const tokens: string[] = [];
  const emitted: StreamlabsEvent[] = [];
  const context = Layer.succeed(
    StreamlabsEngine.EngineContext,
    StreamlabsEngine.EngineContext.of({
      storage: {
        get: Effect.sync(() => storage),
        set: (value) =>
          Effect.sync(() => {
            if (storageDefect !== undefined) throw storageDefect;
            storage = value;
          }),
        update: (f) =>
          Effect.sync(() => {
            storage = f(storage);
          }),
      },
      resource: { refresh: () => Effect.void },
      credentials: {
        get: Effect.succeed([]),
        refresh: () => Effect.die("Unused credentials"),
        subscribe: () => Effect.void,
      },
      client: { refresh: Effect.void },
      emit: (event) =>
        Effect.sync(() => {
          emitted.push(event);
        }),
    }),
  );
  const factory = Layer.succeed(SocketFactory, {
    create: (token) => {
      const socket = new FakeSocket();
      sockets.push(socket);
      tokens.push(token);
      return socket;
    },
  });
  return {
    make: Layer.build(layer.pipe(Layer.provide(Layer.merge(factory, context)))).pipe(
      Effect.flatMap((services) =>
        EngineTest.makeClients(StreamlabsEngine).pipe(Effect.provideContext(services)),
      ),
    ),
    storage: () => storage,
    sockets,
    tokens,
    emitted,
    failStorage: (defect: unknown) => {
      storageDefect = defect;
    },
  };
}

describe("Streamlabs engine", () => {
  it.effect(
    "persists private tokens and cleans up on replacement, disconnect, removal and shutdown",
    () =>
      Effect.gen(function* () {
        const h = harness();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { engine, client } = yield* h.make;
            yield* client.StreamlabsConfigure({ token: "private-token" });
            assert.deepStrictEqual(h.storage(), { token: "private-token", enabled: true });
            assert.deepStrictEqual(yield* engine.client.state, {
              configured: true,
              enabled: true,
              status: "connecting",
            });
            const first = h.sockets[0]!;
            first.emit("connect");
            assert.strictEqual((yield* engine.client.state).status, "connected");
            const staleConnect = first.listeners.get("connect")!;
            yield* client.StreamlabsConfigure({ token: "replacement-token" });
            assert.strictEqual(first.disconnect.mock.calls.length, 1);
            assert.strictEqual(first.listeners.size, 0);
            staleConnect(undefined);
            assert.strictEqual((yield* engine.client.state).status, "connecting");
            assert.isFalse("token" in (yield* engine.client.state));
            const second = h.sockets[1]!;
            second.emit("connect_error", new Error("private-token-in-server-error"));
            assert.deepStrictEqual(yield* engine.client.state, {
              configured: true,
              enabled: true,
              status: "error",
              error: "connection-failed",
            });
            second.emit("connect");
            assert.isFalse("error" in (yield* engine.client.state));
            yield* client.StreamlabsSetEnabled({ enabled: false });
            assert.strictEqual(second.disconnect.mock.calls.length, 1);
            assert.strictEqual(second.listeners.size, 0);
            assert.strictEqual(h.storage().enabled, false);
            yield* client.StreamlabsSetEnabled({ enabled: true });
            yield* client.StreamlabsClear();
            assert.strictEqual(h.storage().token, "");
            assert.strictEqual(h.sockets[2]!.disconnect.mock.calls.length, 1);
            yield* client.StreamlabsConfigure({ token: "shutdown-token" });
          }),
        );
        assert.strictEqual(h.sockets[3]!.disconnect.mock.calls.length, 1);
        assert.strictEqual(h.sockets[3]!.listeners.size, 0);
      }),
  );

  it.effect("restores enabled storage and only emits supported decoded events", () =>
    Effect.gen(function* () {
      const h = harness({ token: "stored-token", enabled: true });
      const { client, engine } = yield* h.make;
      assert.deepStrictEqual(h.tokens, ["stored-token"]);
      const socket = h.sockets[0]!;
      assert.strictEqual(socket.connect.mock.calls.length, 1);
      socket.emit("event", { type: "subscription", for: "twitch_account", message: [{}] });
      socket.emit("event", { type: "donation", message: [{ amount: "Infinity" }] });
      socket.emit("event", {
        type: "donation",
        message: [
          { name: "Donor", amount: "2.50" },
          { name: "Second", amount: "9" },
        ],
      });
      yield* Effect.yieldNow;
      assert.strictEqual(h.emitted.length, 1);
      assert.strictEqual(h.emitted[0]!.amount, 2.5);
      assert.strictEqual(h.emitted[0]!.name, "Donor");
      const late = socket.listeners.get("event")!;
      yield* client.StreamlabsSetEnabled({ enabled: false });
      late({ type: "donation", message: [{ amount: "3" }] });
      yield* Effect.yieldNow;
      assert.strictEqual(h.emitted.length, 1);
      assert.strictEqual((yield* engine.client.state).status, "disconnected");
    }),
  );

  it.effect("rejects missing configuration and malformed tokens without creating sockets", () =>
    Effect.gen(function* () {
      const h = harness();
      const { client } = yield* h.make;
      const enabled = yield* Effect.result(client.StreamlabsSetEnabled({ enabled: true }));
      assert.isTrue(Result.isFailure(enabled));
      if (Result.isFailure(enabled)) assert.strictEqual(enabled.failure.reason, "not-configured");
      for (const token of ["", "secret token", "secret\n", "x".repeat(4097)]) {
        const result = yield* Effect.result(client.StreamlabsConfigure({ token }));
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) {
          assert.strictEqual(result.failure.reason, "invalid-token");
          assert.isFalse(JSON.stringify(result.failure).includes("secret"));
        }
      }
      assert.strictEqual(h.sockets.length, 0);
    }),
  );

  it.effect("sanitizes secret-bearing storage defects for configure, enable and clear RPCs", () =>
    Effect.gen(function* () {
      const initial = { token: "stored-secret-token", enabled: true };
      const h = harness(initial);
      const { engine, client } = yield* h.make;
      const state = yield* engine.client.state;
      h.failStorage(new Error("SQLite query params: stored-secret-token replacement-secret-token"));
      for (const operation of [
        client.StreamlabsConfigure({ token: "replacement-secret-token" }),
        client.StreamlabsSetEnabled({ enabled: false }),
        client.StreamlabsClear(),
      ]) {
        const result = yield* Effect.result(operation);
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) {
          assert.instanceOf(result.failure, StreamlabsFailure);
          assert.strictEqual(result.failure.reason, "storage-failed");
          assert.isFalse(JSON.stringify(result.failure).includes("secret-token"));
          assert.isFalse(String(result.failure).includes("secret-token"));
        }
      }
      assert.deepStrictEqual(h.storage(), initial);
      assert.deepStrictEqual(yield* engine.client.state, state);
      assert.strictEqual(h.sockets.length, 1);
      assert.strictEqual(h.sockets[0]!.disconnect.mock.calls.length, 0);
    }),
  );
});
