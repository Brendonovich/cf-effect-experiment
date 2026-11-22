import { assert, describe, it } from "@effect/vitest";
import { EngineTest } from "@macrograph/module";
import { Effect, Layer } from "effect";

import { KeyboardEngine, KeyboardFailure, type KeyEvent } from "../src/Definition.ts";
import { runtimeLayer } from "../src/Engine.ts";
import * as Transport from "../src/Transport.ts";

const fakeTransport = (listenByDefault: boolean) => {
  const system = { failure: undefined as string | undefined };
  let listener: Transport.Listener | undefined;
  const service = Transport.Service.of({
    source: listenByDefault ? "browser" : "global",
    listenByDefault,
    listen: (onKey) =>
      Effect.acquireRelease(
        Effect.suspend(() => {
          if (system.failure !== undefined)
            return Effect.fail(new KeyboardFailure({ reason: system.failure }));
          listener = onKey;
          return Effect.void;
        }),
        () =>
          Effect.sync(() => {
            listener = undefined;
          }),
      ),
  });
  return {
    service,
    system,
    listening: () => listener !== undefined,
    press: (key: string) => listener?.(key, true),
    release: (key: string) => listener?.(key, false),
  };
};

const harness = Effect.fnUntraced(function* (options: {
  readonly listenByDefault: boolean;
  readonly failure?: string;
}) {
  const transport = fakeTransport(options.listenByDefault);
  transport.system.failure = options.failure;
  let stored: typeof KeyboardEngine.Storage.Type = {};
  const emitted: KeyEvent[] = [];
  const context = Layer.succeed(KeyboardEngine.EngineContext)({
    storage: {
      get: Effect.sync(() => stored),
      set: (value) =>
        Effect.sync(() => {
          stored = value;
        }),
      update: (update) =>
        Effect.sync(() => {
          stored = update(stored);
        }),
    },
    credentials: {
      get: Effect.succeed([]),
      refresh: () => Effect.die("unused"),
      subscribe: () => Effect.void,
    },
    client: { refresh: Effect.void },
    resource: { refresh: () => Effect.void },
    emit: (event) =>
      Effect.sync(() => {
        emitted.push(event);
      }),
  });
  // Build into the test's scope so the listener outlives client creation.
  const built = yield* Layer.build(
    runtimeLayer.pipe(
      Layer.provide(Layer.mergeAll(Layer.succeed(Transport.Service)(transport.service), context)),
    ),
  );
  const clients = yield* EngineTest.makeClients(KeyboardEngine).pipe(Effect.provide(built));
  yield* Effect.yieldNow;
  return { ...clients, transport, emitted, stored: () => stored };
});

const summary = (events: ReadonlyArray<KeyEvent>) =>
  events.map((event) => {
    const held = (["ctrl", "shift", "alt", "meta"] as const).filter((modifier) => event[modifier]);
    return `${event.state} ${[...held, event.key].join("+")}`;
  });

describe("Keyboard engine", () => {
  it.effect("listens by default only when the transport allows it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const browser = yield* harness({ listenByDefault: true });
        assert.isTrue(browser.transport.listening());
        assert.deepStrictEqual(yield* browser.engine.client.state, {
          source: "browser",
          enabled: true,
          listening: true,
        });

        const global = yield* harness({ listenByDefault: false });
        assert.isFalse(global.transport.listening());
        assert.deepStrictEqual(yield* global.engine.client.state, {
          source: "global",
          enabled: false,
          listening: false,
        });
      }),
    ),
  );

  it.effect("emits presses with held modifiers and pairs releases with their press", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { transport, emitted } = yield* harness({ listenByDefault: true });
        const step = (run: () => void) => Effect.sync(run).pipe(Effect.andThen(Effect.yieldNow));

        yield* step(() => transport.press("Ctrl"));
        yield* step(() => transport.press("K"));
        // OS key repeat.
        yield* step(() => transport.press("K"));
        yield* step(() => transport.release("Ctrl"));
        yield* step(() => transport.release("K"));
        yield* step(() => transport.press("K"));
        yield* step(() => transport.release("K"));
        // A release without a press, such as a key held before listening started.
        yield* step(() => transport.release("Shift"));

        assert.deepStrictEqual(summary(emitted), [
          "pressed Ctrl",
          "pressed ctrl+K",
          "released Ctrl",
          "released ctrl+K",
          "pressed K",
          "released K",
        ]);
      }),
    ),
  );

  it.effect("starts and stops listening from settings and persists the choice", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { client, engine, transport, stored } = yield* harness({ listenByDefault: false });

        yield* client.KeyboardSetListening({ enabled: true });
        yield* Effect.yieldNow;
        assert.isTrue(transport.listening());
        assert.deepStrictEqual(stored(), { listen: true });
        assert.isTrue((yield* engine.client.state).listening);

        yield* client.KeyboardSetListening({ enabled: false });
        yield* Effect.yieldNow;
        assert.isFalse(transport.listening());
        assert.deepStrictEqual(stored(), { listen: false });
        assert.deepStrictEqual(yield* engine.client.state, {
          source: "global",
          enabled: false,
          listening: false,
        });
      }),
    ),
  );

  it.effect("reports a hook failure and retries when re-enabled", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const reason = "Failed to start the keyboard hook: access denied";
        const { client, engine, transport } = yield* harness({
          listenByDefault: true,
          failure: reason,
        });
        assert.deepStrictEqual(yield* engine.client.state, {
          source: "browser",
          enabled: true,
          listening: false,
          error: reason,
        });

        transport.system.failure = undefined;
        yield* client.KeyboardSetListening({ enabled: true });
        yield* Effect.yieldNow;
        assert.isTrue(transport.listening());
        assert.deepStrictEqual(yield* engine.client.state, {
          source: "browser",
          enabled: true,
          listening: true,
        });
      }),
    ),
  );
});
