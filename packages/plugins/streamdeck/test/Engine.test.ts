import { assert, describe, it } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Adapter, type Client, ListenerError } from "@macrograph/plugin-websocket-server/Listener";
import { Deferred, Effect, Layer, Result } from "effect";

import { DEFAULT_PORT, type KeyEvent, StreamDeckEngine } from "../src/Definition.ts";
import layer from "../src/Engine.ts";

describe("Stream Deck transport adapter", () => {
  it.effect("delegates uniquely named management RPCs and reports listener bind failures", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let storage: typeof StreamDeckEngine.Storage.Type = { servers: [] };
        let active = false;
        let onClient: ((client: Client) => Effect.Effect<void>) | undefined;
        const events: KeyEvent[] = [];
        const emitted = yield* Deferred.make<void>();
        const dependencies = Layer.mergeAll(
          Layer.succeed(Adapter)({
            listen: ({ port }) =>
              Effect.gen(function* () {
                if (port !== DEFAULT_PORT || active)
                  return yield* new ListenerError({ reason: "Address already in use" });
                active = true;
                yield* Effect.addFinalizer(() =>
                  Effect.sync(() => {
                    active = false;
                  }),
                );
                return {
                  run: (callback) =>
                    Effect.sync(() => {
                      onClient = callback;
                    }).pipe(Effect.andThen(Effect.never)),
                };
              }),
          }),
          Layer.succeed(StreamDeckEngine.EngineContext)({
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
            resource: { refresh: () => Effect.void },
            client: { refresh: Effect.void },
            credentials: {
              get: Effect.succeed([]),
              refresh: () => Effect.die("unused"),
              subscribe: () => Effect.void,
            },
            emit: (event) =>
              Effect.sync(() => {
                events.push(event);
                Deferred.doneUnsafe(emitted, Effect.void);
              }),
          }),
        );
        const built = yield* Layer.build(layer.pipe(Layer.provide(dependencies)));
        const h = yield* EngineTest.makeClients(StreamDeckEngine).pipe(
          Effect.provideContext(built),
        );
        const id = yield* h.client.StreamDeckWebSocketServerAdd({
          name: "Stream Deck",
          host: "127.0.0.1",
          port: DEFAULT_PORT,
        });
        yield* h.client.StreamDeckWebSocketServerStart({ id });
        assert.isTrue(active);
        while (!onClient) yield* Effect.yieldNow;
        const closed = yield* Deferred.make<void>();
        let onMessage: ((message: unknown) => Effect.Effect<void>) | undefined;
        yield* onClient({
          closed: Deferred.await(closed),
          send: () => Effect.die("Stream Deck does not send messages"),
          run: (callback) =>
            Effect.sync(() => {
              onMessage = callback;
            }).pipe(Effect.andThen(Deferred.await(closed))),
        }).pipe(Effect.forkChild);
        while (!onMessage) yield* Effect.yieldNow;
        yield* onMessage(
          JSON.stringify({
            event: "keyDown",
            payload: {
              coordinates: { column: 0, row: 0 },
              isInMultiAction: false,
              settings: { id: "key", remoteServer: "" },
            },
          }),
        );
        yield* Deferred.await(emitted);
        assert.strictEqual(events[0]!.serverId, id);
        assert.strictEqual(events[0]!.payload.settings.id, "key");
        yield* h.client.StreamDeckWebSocketServerStop({ id });
        assert.isFalse(active);
        assert.strictEqual(
          (yield* h.client.StreamDeckWebSocketServerStatus({ id })).status,
          "stopped",
        );
        const bad = yield* h.client.StreamDeckWebSocketServerAdd({
          name: "Unavailable",
          host: "127.0.0.1",
          port: 1881,
        });
        assert.isTrue(
          Result.isFailure(
            yield* Effect.result(h.client.StreamDeckWebSocketServerStart({ id: bad })),
          ),
        );
        assert.strictEqual(
          (yield* h.client.StreamDeckWebSocketServerStatus({ id: bad })).status,
          "error",
        );
        yield* h.client.StreamDeckWebSocketServerRemove({ id: bad });
        assert.strictEqual(storage.servers.length, 1);
      }),
    ),
  );
});
