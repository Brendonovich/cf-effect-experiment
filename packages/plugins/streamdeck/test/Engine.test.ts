import { assert, describe, it } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Adapter, type Client, ListenerError } from "@macrograph/plugin-websocket-server/Listener";
import * as Protocol from "@macrograph/streamdeck-protocol";
import { Deferred, Effect, Layer, Result } from "effect";

import {
  ButtonId,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DeviceId,
  StreamDeckEngine,
  StreamDeckKeyDown,
  StreamDeckKeyUp,
} from "../src/Definition.ts";
import layer from "../src/Engine.ts";

const harness = (
  storage: { current: typeof StreamDeckEngine.Storage.Type },
  options?: {
    readonly events?: Array<StreamDeckKeyDown | StreamDeckKeyUp>;
    readonly keyEmitted?: Deferred.Deferred<void>;
    readonly sent?: Array<string>;
  },
) => {
  let active = false;
  let onClient: ((client: Client) => Effect.Effect<void>) | undefined;
  const events = options?.events ?? [];
  const sent = options?.sent ?? [];
  const dependencies = Layer.mergeAll(
    Layer.succeed(Adapter)({
      listen: ({ host, port }) =>
        Effect.gen(function* () {
          if (port !== DEFAULT_PORT || host !== DEFAULT_HOST || active)
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
        get: Effect.sync(() => storage.current),
        set: (value) =>
          Effect.sync(() => {
            storage.current = value;
          }),
        update: (update) =>
          Effect.sync(() => {
            storage.current = update(storage.current);
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
          if (event instanceof StreamDeckKeyDown || event instanceof StreamDeckKeyUp) {
            events.push(event);
            if (options?.keyEmitted !== undefined)
              Deferred.doneUnsafe(options.keyEmitted, Effect.void);
          }
        }),
    }),
  );
  return { dependencies, getOnClient: () => onClient, isActive: () => active, sent };
};

describe("Stream Deck engine", () => {
  it.effect("auto-seeds default listener, handshake, bind, keys, queryButtons", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const storage: { current: typeof StreamDeckEngine.Storage.Type } = {
          current: {
            servers: [],
            buttons: [{ id: ButtonId.make("btn-1"), name: "Mute" }],
          },
        };
        const events: Array<StreamDeckKeyDown | StreamDeckKeyUp> = [];
        const sent: Array<string> = [];
        const keyEmitted = yield* Deferred.make<void>();
        const { dependencies, getOnClient, isActive } = harness(storage, {
          events,
          keyEmitted,
          sent,
        });
        const built = yield* Layer.build(layer.pipe(Layer.provide(dependencies)));
        const h = yield* EngineTest.makeClients(StreamDeckEngine).pipe(
          Effect.provideContext(built),
        );

        const bridge = yield* h.engine.client.state;
        assert.strictEqual(bridge.servers.length, 1);
        assert.strictEqual(bridge.servers[0]?.definition.host, DEFAULT_HOST);
        assert.strictEqual(bridge.servers[0]?.definition.port, DEFAULT_PORT);
        assert.isTrue(isActive());

        while (!getOnClient()) yield* Effect.yieldNow;

        const closed = yield* Deferred.make<void>();
        let onMessage: ((message: unknown) => Effect.Effect<void>) | undefined;
        yield* getOnClient()!({
          closed: Deferred.await(closed),
          send: (message) =>
            Effect.sync(() => {
              sent.push(message);
            }),
          run: (callback) =>
            Effect.sync(() => {
              onMessage = callback;
            }).pipe(Effect.andThen(Deferred.await(closed))),
        }).pipe(Effect.forkChild);
        while (!onMessage) yield* Effect.yieldNow;

        yield* onMessage(JSON.stringify(Protocol.hello("com.macrograph.streamdeck")));
        while (sent.length === 0) yield* Effect.yieldNow;
        assert.deepStrictEqual(JSON.parse(sent[0]!), Protocol.helloAck());

        yield* onMessage(
          JSON.stringify(
            Protocol.deviceConnected({
              id: "device-1",
              type: "Stream Deck",
              size: { column: 5, row: 3 },
            }),
          ),
        );
        yield* onMessage(
          JSON.stringify(
            Protocol.appear({
              deviceId: "device-1",
              action: "com.macrograph.streamdeck.button",
              context: "ctx-1",
              coordinates: { column: 1, row: 2 },
              settings: { [Protocol.BUTTON_SETTING_KEY]: "btn-1" },
            }),
          ),
        );

        const client = yield* h.engine.client.state;
        assert.strictEqual(client.buttons[0]?.bound, true);
        assert.strictEqual(client.devices[0]?.id, DeviceId.make("device-1"));
        assert.strictEqual(client.devices[0]?.bindingCount, 1);

        yield* onMessage(
          JSON.stringify(
            Protocol.keyDown({
              deviceId: "device-1",
              action: "com.macrograph.streamdeck.button",
              context: "ctx-1",
              coordinates: { column: 1, row: 2 },
              settings: { [Protocol.BUTTON_SETTING_KEY]: "btn-1" },
              payload: { value: 42, state: 1 },
            }),
          ),
        );
        yield* Deferred.await(keyEmitted);
        assert.instanceOf(events[0], StreamDeckKeyDown);
        assert.strictEqual(events[0]!.buttonId, ButtonId.make("btn-1"));
        assert.strictEqual(events[0]!.state, 1);
        assert.deepStrictEqual(events[0]!.payload, { value: 42, state: 1 });

        sent.length = 0;
        yield* onMessage(JSON.stringify(Protocol.queryButtons("req-1")));
        while (sent.length === 0) yield* Effect.yieldNow;
        assert.deepStrictEqual(
          JSON.parse(sent[0]!),
          Protocol.buttonList("req-1", [{ id: "btn-1", name: "Mute" }]),
        );

        yield* h.runtime.StreamDeckSetTitle({ button: ButtonId.make("btn-1"), title: "ON" });
        while (sent.length < 2) yield* Effect.yieldNow;
        assert.deepStrictEqual(JSON.parse(sent[1]!), Protocol.setTitle("ctx-1", "ON"));

        const buttonId = yield* h.client.StreamDeckAddButton({ name: "Scene A" });
        assert.strictEqual(storage.current.buttons.length, 2);
        yield* h.client.StreamDeckUpdateButton({ id: buttonId, name: "Scene B" });
        assert.strictEqual(storage.current.buttons[1]?.name, "Scene B");
        yield* h.client.StreamDeckRemoveButton({ id: buttonId });
        assert.strictEqual(storage.current.buttons.length, 1);
        assert.isTrue(
          Result.isFailure(yield* Effect.result(h.client.StreamDeckAddButton({ name: "   " }))),
        );
      }),
    ),
  );

  it.effect("rejects bad hello, ignores unbound keys, unbound setTitle succeeds", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const storage: { current: typeof StreamDeckEngine.Storage.Type } = {
          current: { servers: [], buttons: [] },
        };
        const events: Array<StreamDeckKeyDown | StreamDeckKeyUp> = [];
        const sent: Array<string> = [];
        const { dependencies, getOnClient } = harness(storage, { events, sent });
        const built = yield* Layer.build(layer.pipe(Layer.provide(dependencies)));
        const h = yield* EngineTest.makeClients(StreamDeckEngine).pipe(
          Effect.provideContext(built),
        );
        while (!getOnClient()) yield* Effect.yieldNow;

        const closed = yield* Deferred.make<void>();
        let onMessage: ((message: unknown) => Effect.Effect<void>) | undefined;
        yield* getOnClient()!({
          closed: Deferred.await(closed),
          send: (message) =>
            Effect.sync(() => {
              sent.push(message);
            }),
          run: (callback) =>
            Effect.sync(() => {
              onMessage = callback;
            }).pipe(Effect.andThen(Deferred.await(closed))),
        }).pipe(Effect.forkChild);
        while (!onMessage) yield* Effect.yieldNow;

        yield* onMessage(
          JSON.stringify({
            type: "hello",
            version: 999,
            client: "wrong",
            pluginUuid: "x",
          }),
        );
        assert.strictEqual(sent.length, 0);

        yield* onMessage(
          JSON.stringify(
            Protocol.keyDown({
              deviceId: "device-1",
              action: "com.macrograph.streamdeck.button",
              context: "ctx",
              coordinates: { column: 0, row: 0 },
              settings: { [Protocol.BUTTON_SETTING_KEY]: "btn" },
            }),
          ),
        );
        assert.strictEqual(events.length, 0);

        yield* onMessage(JSON.stringify(Protocol.hello("com.macrograph.streamdeck")));
        while (sent.length === 0) yield* Effect.yieldNow;

        for (const message of [
          "not-json",
          "{}",
          JSON.stringify({ type: "keyDown" }),
          JSON.stringify(
            Protocol.keyDown({
              deviceId: "device-1",
              action: "com.macrograph.streamdeck.button",
              context: "ctx-unbound",
              coordinates: { column: 0, row: 0 },
              settings: {},
            }),
          ),
        ])
          yield* onMessage(message);

        assert.strictEqual(events.length, 0);
        yield* h.runtime.StreamDeckSetTitle({ button: ButtonId.make("missing"), title: "x" });
      }),
    ),
  );
});
