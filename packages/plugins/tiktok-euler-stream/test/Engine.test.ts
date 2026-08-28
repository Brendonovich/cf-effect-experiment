import { assert, describe, it, vi } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Effect, Layer, Result } from "effect";

import {
  TikTokEngine,
  type TikTokEvent,
  type TransportMode,
  type ClientState,
} from "../src/Definition.ts";
import { layer } from "../src/Engine.ts";
import { ClientFactory, type ClientEvent, type TikTokClient } from "../src/Transport.ts";

class FakeClient implements TikTokClient {
  readonly pending = Promise.withResolvers<unknown>();
  readonly listeners = new Map<ClientEvent, (payload: unknown) => void>();
  readonly connect = vi.fn(() => this.pending.promise);
  readonly disconnect = vi.fn(async () => {});
  on(event: ClientEvent, listener: (payload: unknown) => void) {
    this.listeners.set(event, listener);
  }
  off(event: ClientEvent, listener: (payload: unknown) => void) {
    if (this.listeners.get(event) === listener) this.listeners.delete(event);
  }
  emit(event: ClientEvent, payload: unknown) {
    this.listeners.get(event)?.(payload);
  }
}

function harness(
  initial: typeof TikTokEngine.Storage.Type = {
    mode: "connector",
    username: "",
    apiKey: "",
    enabled: false,
  },
) {
  let storage = initial;
  let storageDefect: unknown;
  const clients: FakeClient[] = [];
  const configs: Array<{
    readonly username: string;
    readonly apiKey: string;
    readonly mode: TransportMode;
  }> = [];
  const emitted: TikTokEvent[] = [];
  const refreshed: Array<typeof ClientState.Type> = [];
  let readState: Effect.Effect<typeof ClientState.Type> | undefined;
  const context = Layer.succeed(
    TikTokEngine.EngineContext,
    TikTokEngine.EngineContext.of({
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
        refresh: () => Effect.die("Unused"),
        subscribe: () => Effect.void,
      },
      client: {
        refresh: Effect.suspend(() =>
          readState
            ? readState.pipe(
                Effect.tap((state) =>
                  Effect.sync(() => {
                    refreshed.push(state);
                  }),
                ),
                Effect.asVoid,
              )
            : Effect.void,
        ),
      },
      emit: (event) =>
        Effect.sync(() => {
          emitted.push(event);
        }),
    }),
  );
  const factory = Layer.succeed(ClientFactory, {
    create: (config) => {
      const client = new FakeClient();
      clients.push(client);
      configs.push(config);
      return client;
    },
  });
  return {
    make: Layer.build(layer.pipe(Layer.provide(Layer.merge(context, factory)))).pipe(
      Effect.flatMap((services) =>
        EngineTest.makeClients(TikTokEngine).pipe(Effect.provideContext(services)),
      ),
      Effect.tap(({ engine }) =>
        Effect.sync(() => {
          readState = engine.client.state;
        }),
      ),
    ),
    clients,
    configs,
    emitted,
    refreshed,
    storage: () => storage,
    failStorage: (defect: unknown) => {
      storageDefect = defect;
    },
  };
}

const flush = Effect.promise(() => Promise.resolve()).pipe(Effect.andThen(Effect.yieldNow));

describe("TikTok scoped engine", () => {
  for (const tail of ["silence", "error", "disconnected", "error-and-disconnected"] as const) {
    it.effect(`refreshes the latest state after queue overflow followed by ${tail}`, () =>
      Effect.gen(function* () {
        const h = harness({ mode: "connector", username: "creator", apiKey: "", enabled: true });
        const { engine } = yield* h.make;
        const socket = h.clients[0]!;
        socket.pending.resolve({ roomId: "room" });
        yield* flush;
        yield* flush;
        const before = h.refreshed.length;
        for (let index = 0; index < 1100; index++)
          socket.emit("chat", { content: `chat-${index}` });
        assert.strictEqual((yield* engine.client.state).error, "event-overflow");
        if (tail === "error" || tail === "error-and-disconnected")
          socket.emit("error", { reason: "provider-failed" });
        if (tail === "disconnected" || tail === "error-and-disconnected")
          socket.emit("disconnected", {});
        const latest = yield* engine.client.state;
        assert.strictEqual(
          latest.status,
          tail === "silence" ? "connected" : tail === "disconnected" ? "disconnected" : "error",
        );
        for (let attempt = 0; attempt < 100 && h.emitted.length < 1024; attempt++) yield* flush;
        yield* flush;
        assert.strictEqual(h.emitted.length, 1024);
        assert.isAbove(h.refreshed.length, before);
        assert.isAtMost(h.refreshed.length - before, 2);
        assert.deepStrictEqual(h.refreshed.at(-1), latest);
        const after = h.refreshed.length;
        yield* flush;
        assert.strictEqual(h.refreshed.length, after);
      }),
    );
  }
  it.effect("starts in connector mode and requires a key for explicit managed mode", () =>
    Effect.gen(function* () {
      const h = harness();
      const { client, engine } = yield* h.make;
      assert.strictEqual((yield* engine.client.state).mode, "connector");
      yield* client.TikTokConfigure({ username: "creator", mode: "managed" });
      assert.strictEqual(h.clients.length, 0);
      assert.strictEqual((yield* engine.client.state).mode, "managed");
      const missing = yield* Effect.result(client.TikTokSetEnabled({ enabled: true }));
      assert.isTrue(Result.isFailure(missing));
      yield* client.TikTokConfigure({
        mode: "managed",
        username: "creator",
        apiKey: "managed-secret",
      });
      yield* client.TikTokSetEnabled({ enabled: true });
      assert.deepStrictEqual(h.configs[0], {
        mode: "managed",
        username: "creator",
        apiKey: "managed-secret",
      });
      const first = h.clients[0]!;
      first.emit("roomInfo", { roomId: "room" });
      assert.strictEqual((yield* engine.client.state).status, "connecting");
      first.emit("connected", { roomId: "room" });
      first.emit("connecting", { roomId: "room" });
      first.pending.resolve(undefined);
      yield* flush;
      assert.strictEqual((yield* engine.client.state).status, "connecting");
      first.emit("error", { reason: "authentication-failed", message: "managed-secret" });
      assert.strictEqual((yield* engine.client.state).error, "authentication-failed");
      assert.isFalse(JSON.stringify(yield* engine.client.state).includes("managed-secret"));
      yield* client.TikTokConfigure({ username: "creator", mode: "connector" });
      assert.strictEqual(first.disconnect.mock.calls.length, 1);
      assert.strictEqual(first.listeners.size, 0);
      assert.strictEqual(h.configs[1]!.mode, "connector");
      yield* client.TikTokClear();
      assert.strictEqual(h.storage().mode, "connector");
    }),
  );
  it.effect(
    "is inert until enabled, persists private configuration and disposes replaced clients",
    () =>
      Effect.gen(function* () {
        const h = harness();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { client, engine } = yield* h.make;
            assert.strictEqual(h.clients.length, 0);
            yield* client.TikTokConfigure({
              mode: "connector",
              username: " @creator ",
              apiKey: "secret-one",
            });
            assert.deepStrictEqual(h.storage(), {
              mode: "connector",
              username: "creator",
              apiKey: "secret-one",
              enabled: false,
            });
            assert.strictEqual(h.clients.length, 0);
            assert.isFalse(JSON.stringify(yield* engine.client.state).includes("secret-one"));
            yield* client.TikTokSetEnabled({ enabled: true });
            const first = h.clients[0]!;
            assert.strictEqual(first.connect.mock.calls.length, 1);
            assert.strictEqual((yield* engine.client.state).status, "connecting");
            first.pending.resolve({ roomId: "room-one" });
            yield* flush;
            assert.strictEqual((yield* engine.client.state).roomId, "room-one");
            const stale = first.listeners.get("connected")!;
            yield* client.TikTokConfigure({ mode: "connector", username: "replacement" });
            assert.strictEqual(h.storage().apiKey, "secret-one");
            assert.strictEqual(first.listeners.size, 0);
            assert.strictEqual(first.disconnect.mock.calls.length, 1);
            stale({ roomId: "stale" });
            assert.strictEqual((yield* engine.client.state).roomId, "");
            yield* client.TikTokConfigure({
              mode: "connector",
              username: "replacement",
              apiKey: "",
            });
            assert.strictEqual(h.storage().apiKey, "");
            assert.isFalse((yield* engine.client.state).apiKeyConfigured);
            yield* client.TikTokSetEnabled({ enabled: false });
            assert.strictEqual(h.clients[2]!.listeners.size, 0);
            assert.strictEqual((yield* engine.client.state).status, "disconnected");
            yield* client.TikTokSetEnabled({ enabled: true });
            yield* client.TikTokClear();
            assert.deepStrictEqual(h.storage(), {
              mode: "connector",
              username: "",
              apiKey: "",
              enabled: false,
            });
            yield* client.TikTokConfigure({ mode: "connector", username: "shutdown" });
            yield* client.TikTokSetEnabled({ enabled: true });
          }),
        );
        assert.strictEqual(h.clients[4]!.disconnect.mock.calls.length, 1);
        assert.strictEqual(h.clients[4]!.listeners.size, 0);
      }),
  );

  it.effect(
    "closes in-flight connections again when they complete after replacement or scope shutdown",
    () =>
      Effect.gen(function* () {
        const h = harness({ mode: "connector", username: "creator", apiKey: "", enabled: true });
        yield* Effect.scoped(
          Effect.gen(function* () {
            const { client, engine } = yield* h.make;
            yield* client.TikTokConfigure({ mode: "connector", username: "replacement" });
            h.clients[0]!.pending.resolve({ roomId: "stale" });
            yield* flush;
            assert.strictEqual(h.clients[0]!.disconnect.mock.calls.length, 2);
            assert.strictEqual((yield* engine.client.state).status, "connecting");
            assert.strictEqual((yield* engine.client.state).roomId, "");
          }),
        );
        h.clients[1]!.pending.resolve({ roomId: "after-shutdown" });
        yield* flush;
        assert.strictEqual(h.clients[1]!.disconnect.mock.calls.length, 2);
        assert.strictEqual(h.clients[1]!.listeners.size, 0);
      }),
  );

  it.effect("emits validated payloads, separates gift streaks and ignores stale callbacks", () =>
    Effect.gen(function* () {
      const h = harness({ mode: "connector", username: "creator", apiKey: "", enabled: true });
      const { client, engine } = yield* h.make;
      const socket = h.clients[0]!;
      socket.emit("chat", { content: 1 });
      assert.strictEqual((yield* engine.client.state).error, "invalid-payload");
      socket.emit("chat", { user: { displayId: "viewer" }, content: "hello" });
      socket.emit("gift", { giftId: "1", gift: { type: 1 }, repeatEnd: 0 });
      socket.emit("gift", { giftId: "1", gift: { type: 1 }, repeatEnd: 1 });
      socket.emit("social", { user: { displayId: "viewer" }, action: "0" });
      yield* flush;
      assert.deepStrictEqual(
        h.emitted.map((event) => event.kind),
        ["chat", "giftStreak", "gift"],
      );
      assert.strictEqual(h.emitted[0]!.user, "viewer");
      const stale = socket.listeners.get("chat")!;
      // Also invalidate an already queued event before it reaches the emitter.
      socket.emit("chat", { content: "queued" });
      yield* client.TikTokSetEnabled({ enabled: false });
      stale({ content: "late" });
      yield* flush;
      assert.strictEqual(h.emitted.length, 3);
    }),
  );

  it.effect("sanitizes connection failures and keeps errors visible after disconnected", () =>
    Effect.gen(function* () {
      const h = harness({
        mode: "connector",
        username: "creator",
        apiKey: "private-key",
        enabled: true,
      });
      const { client, engine } = yield* h.make;
      h.clients[0]!.pending.reject(new Error("Provider rejected private-key"));
      yield* flush;
      assert.strictEqual((yield* engine.client.state).status, "error");
      assert.strictEqual((yield* engine.client.state).error, "connection-failed");
      h.clients[0]!.emit("disconnected", { reason: "private-key" });
      assert.strictEqual((yield* engine.client.state).error, "connection-failed");
      assert.isFalse(JSON.stringify(yield* engine.client.state).includes("private-key"));
      yield* client.TikTokSetEnabled({ enabled: true });
      assert.isUndefined((yield* engine.client.state).error);
      h.clients[1]!.emit("connected", { roomId: 1 });
      assert.strictEqual((yield* engine.client.state).error, "invalid-payload");
      h.clients[1]!.disconnect.mockRejectedValue(new Error("private-key"));
      yield* client.TikTokSetEnabled({ enabled: false });
      assert.strictEqual((yield* engine.client.state).error, "disconnect-failed");
    }),
  );

  it.effect(
    "rejects invalid settings and sanitizes storage failures without changing a live client",
    () =>
      Effect.gen(function* () {
        const h = harness();
        const { client, engine } = yield* h.make;
        const missing = yield* Effect.result(client.TikTokSetEnabled({ enabled: true }));
        assert.isTrue(Result.isFailure(missing));
        for (const username of [
          "",
          "https://tiktok.com/@user",
          "bad name",
          "x".repeat(25),
          "@",
          "../user",
        ])
          assert.isTrue(
            Result.isFailure(
              yield* Effect.result(client.TikTokConfigure({ mode: "connector", username })),
            ),
          );
        for (const apiKey of ["bad key", "secret\n", "x".repeat(4097)]) {
          const result = yield* Effect.result(
            client.TikTokConfigure({ mode: "connector", username: "creator", apiKey }),
          );
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result))
            assert.strictEqual(result.failure.reason, "invalid-api-key");
        }
        assert.strictEqual(h.clients.length, 0);
        yield* client.TikTokConfigure({
          mode: "connector",
          username: "creator",
          apiKey: "stored-secret",
        });
        yield* client.TikTokSetEnabled({ enabled: true });
        const original = h.storage();
        const originalState = yield* engine.client.state;
        h.failStorage(new Error("SQL parameters stored-secret replacement-secret"));
        for (const operation of [
          client.TikTokConfigure({
            mode: "connector",
            username: "other",
            apiKey: "replacement-secret",
          }),
          client.TikTokSetEnabled({ enabled: false }),
          client.TikTokClear(),
        ]) {
          const result = yield* Effect.result(operation);
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) {
            assert.strictEqual(result.failure.reason, "storage-failed");
            assert.isFalse(JSON.stringify(result.failure).includes("secret"));
          }
        }
        assert.deepStrictEqual(h.storage(), original);
        assert.deepStrictEqual(yield* engine.client.state, originalState);
        assert.strictEqual(h.clients[0]!.disconnect.mock.calls.length, 0);
      }),
  );

  it.effect("keeps projects independent and rejects invalid enabled persisted configuration", () =>
    Effect.gen(function* () {
      const first = harness({
        mode: "connector",
        username: "first",
        apiKey: "first-key",
        enabled: true,
      });
      const second = harness({
        mode: "connector",
        username: "second",
        apiKey: "second-key",
        enabled: true,
      });
      const a = yield* first.make;
      const b = yield* second.make;
      yield* a.client.TikTokClear();
      assert.strictEqual(second.clients[0]!.disconnect.mock.calls.length, 0);
      assert.strictEqual((yield* b.engine.client.state).username, "second");
      assert.deepStrictEqual(second.configs, [
        { mode: "connector", username: "second", apiKey: "second-key" },
      ]);
      const invalid = harness({ mode: "connector", username: "", apiKey: "", enabled: true });
      const c = yield* invalid.make;
      assert.strictEqual(invalid.clients.length, 0);
      assert.strictEqual((yield* c.engine.client.state).error, "not-configured");
    }),
  );
});
