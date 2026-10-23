import { assert, describe, it } from "@effect/vitest";
import { EngineTest } from "@macrograph/module";
import { Effect, Layer, Result } from "effect";
import { TestClock } from "effect/testing";

import {
  InputId,
  MidiEngine,
  MidiFailure,
  MidiInput,
  type MidiMessage,
  MidiOutput,
  OutputId,
} from "../src/Definition.ts";
import { runtimeLayer } from "../src/Engine.ts";
import * as Transport from "../src/Transport.ts";

const launchpad = "Launchpad Mini MK3";
const inputId = InputId.make(launchpad);
const outputId = OutputId.make(launchpad);

const fakeTransport = () => {
  const system = {
    inputs: [launchpad] as string[],
    outputs: [launchpad] as string[],
    failInput: undefined as string | undefined,
    unavailable: false,
  };
  const listeners = new Map<string, (data: ReadonlyArray<number>) => void>();
  const sent: Array<[string, ReadonlyArray<number>]> = [];
  let opens = 0;
  let closes = 0;
  const service = Transport.Service.of({
    ports: Effect.suspend(() =>
      system.unavailable
        ? Effect.fail(new MidiFailure({ reason: "Native MIDI support is unavailable" }))
        : Effect.succeed({
            inputs: system.inputs.map((name) => InputId.make(name)),
            outputs: system.outputs.map((name) => OutputId.make(name)),
          }),
    ),
    openInput: (id, onMessage) =>
      Effect.acquireRelease(
        Effect.suspend(() => {
          if (system.failInput) return Effect.fail(new MidiFailure({ reason: system.failInput }));
          opens++;
          listeners.set(id, onMessage);
          return Effect.void;
        }),
        () =>
          Effect.sync(() => {
            closes++;
            listeners.delete(id);
          }),
      ),
    openOutput: (id) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          opens++;
        }),
        () =>
          Effect.sync(() => {
            closes++;
          }),
      ).pipe(
        Effect.as({
          send: (data: ReadonlyArray<number>) =>
            Effect.sync(() => {
              sent.push([id, data]);
            }),
        }),
      ),
  });
  return {
    service,
    system,
    listeners,
    sent,
    counts: () => ({ opens, closes }),
  };
};

// Build into the test's scope so background scanning and open ports outlive client creation.
const mount = Effect.fnUntraced(function* (
  transport: ReturnType<typeof fakeTransport>,
  context: Layer.Layer<(typeof MidiEngine.EngineContext)["Identifier"]>,
) {
  const built = yield* Layer.build(
    runtimeLayer.pipe(
      Layer.provide(Layer.mergeAll(Layer.succeed(Transport.Service)(transport.service), context)),
    ),
  );
  return yield* EngineTest.makeClients(MidiEngine).pipe(Effect.provide(built));
});

const harness = Effect.fnUntraced(function* (enabledInputs: ReadonlyArray<InputId> = []) {
  const transport = fakeTransport();
  let stored = { enabledInputs };
  const emitted: MidiMessage[] = [];
  const refreshed: string[] = [];
  const clients = yield* mount(
    transport,
    Layer.succeed(MidiEngine.EngineContext)({
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
      resource: {
        refresh: (resource) =>
          Effect.sync(() => {
            refreshed.push(resource.key);
          }),
      },
      emit: (event) =>
        Effect.sync(() => {
          emitted.push(event);
        }),
    }),
  );
  return { ...clients, transport, emitted, refreshed, stored: () => stored };
});

describe("MIDI engine", () => {
  it.effect("detects ports and opens an output once for repeated sends", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { engine, runtime, transport } = yield* harness();
        assert.deepStrictEqual(yield* MidiOutput.values.pipe(Effect.provide(engine.resources)), [
          { id: outputId, display: launchpad },
        ]);
        assert.deepStrictEqual(yield* MidiInput.values.pipe(Effect.provide(engine.resources)), []);
        assert.deepStrictEqual(transport.counts(), { opens: 0, closes: 0 });

        yield* runtime.MidiSend({ outputId, data: [0x90, 11, 5] });
        yield* runtime.MidiSend({ outputId, data: [0x80, 11, 0] });
        assert.deepStrictEqual(transport.sent, [
          [launchpad, [0x90, 11, 5]],
          [launchpad, [0x80, 11, 0]],
        ]);
        assert.deepStrictEqual(transport.counts(), { opens: 1, closes: 0 });
        assert.deepStrictEqual((yield* engine.client.state).outputs, [
          { id: outputId, open: true },
        ]);

        const missing = yield* Effect.flip(
          runtime.MidiSend({ outputId: OutputId.make("Nope"), data: [0x90, 1, 1] }),
        );
        assert.strictEqual(missing.reason, "MIDI output not connected: Nope");
        assert.isTrue(
          Result.isFailure(yield* Effect.result(runtime.MidiSend({ outputId, data: [0x10] }))),
        );
      }),
    ),
  );

  it.effect("listens to enabled inputs and emits their messages", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { engine, client, transport, emitted, stored } = yield* harness();
        assert.isFalse(transport.listeners.has(launchpad));

        yield* client.MidiSetInputEnabled({ id: inputId, enabled: true });
        yield* Effect.yieldNow;
        assert.deepStrictEqual(stored().enabledInputs, [inputId]);
        assert.isTrue(transport.listeners.has(launchpad));
        assert.deepStrictEqual(yield* MidiInput.values.pipe(Effect.provide(engine.resources)), [
          { id: inputId, display: launchpad },
        ]);
        assert.deepStrictEqual((yield* engine.client.state).inputs, [
          { id: inputId, connected: true, enabled: true, listening: true },
        ]);

        transport.listeners.get(launchpad)!([0x90, 81, 127]);
        yield* Effect.yieldNow;
        assert.deepStrictEqual(
          emitted.map((event) => [event.inputId, event.data]),
          [[inputId, [0x90, 81, 127]]],
        );

        yield* client.MidiSetInputEnabled({ id: inputId, enabled: false });
        yield* Effect.yieldNow;
        assert.isFalse(transport.listeners.has(launchpad));
        assert.deepStrictEqual(stored().enabledInputs, []);
      }),
    ),
  );

  it.effect("follows devices being unplugged and reconnected", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { engine, runtime, transport, refreshed } = yield* harness([inputId]);
        yield* Effect.yieldNow;
        assert.isTrue(transport.listeners.has(launchpad));
        yield* runtime.MidiSend({ outputId, data: [0xb0, 1, 1] });
        const initialRefreshes = refreshed.length;

        transport.system.inputs = [];
        transport.system.outputs = [];
        yield* TestClock.adjust("2 seconds");
        yield* Effect.yieldNow;
        assert.isFalse(transport.listeners.has(launchpad));
        assert.isAbove(refreshed.length, initialRefreshes);
        assert.deepStrictEqual(yield* MidiInput.values.pipe(Effect.provide(engine.resources)), [
          { id: inputId, display: `${launchpad} (disconnected)` },
        ]);
        assert.deepStrictEqual((yield* engine.client.state).inputs, [
          { id: inputId, connected: false, enabled: true, listening: false },
        ]);
        // Output and input were both opened, then both released.
        assert.deepStrictEqual(transport.counts(), { opens: 2, closes: 2 });

        transport.system.inputs = [launchpad];
        transport.system.outputs = [launchpad];
        yield* TestClock.adjust("2 seconds");
        yield* Effect.yieldNow;
        assert.isTrue(transport.listeners.has(launchpad));
        yield* runtime.MidiSend({ outputId, data: [0xb0, 1, 2] });
        assert.deepStrictEqual(transport.counts(), { opens: 4, closes: 2 });
      }),
    ),
  );

  it.effect("records input failures without retrying until a rescan", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { engine, client, transport } = yield* harness();
        transport.system.failInput = "Port is in use";
        yield* client.MidiSetInputEnabled({ id: inputId, enabled: true });
        yield* Effect.yieldNow;
        assert.deepStrictEqual((yield* engine.client.state).inputs, [
          {
            id: inputId,
            connected: true,
            enabled: true,
            listening: false,
            error: "Port is in use",
          },
        ]);

        transport.system.failInput = undefined;
        yield* TestClock.adjust("2 seconds");
        yield* Effect.yieldNow;
        assert.isFalse(transport.listeners.has(launchpad));

        yield* client.MidiRescan();
        yield* Effect.yieldNow;
        assert.isTrue(transport.listeners.has(launchpad));
        assert.deepStrictEqual((yield* engine.client.state).inputs, [
          { id: inputId, connected: true, enabled: true, listening: true },
        ]);
      }),
    ),
  );

  it.effect("reports an unavailable native backend instead of failing to mount", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const transport = fakeTransport();
        transport.system.unavailable = true;
        const { engine, runtime } = yield* mount(
          transport,
          Layer.succeed(MidiEngine.EngineContext)({
            storage: {
              get: Effect.succeed({ enabledInputs: [] }),
              set: () => Effect.void,
              update: () => Effect.void,
            },
            credentials: {
              get: Effect.succeed([]),
              refresh: () => Effect.die("unused"),
              subscribe: () => Effect.void,
            },
            client: { refresh: Effect.void },
            resource: { refresh: () => Effect.void },
            emit: () => Effect.void,
          }),
        );
        assert.deepStrictEqual(yield* engine.client.state, {
          available: false,
          error: "Native MIDI support is unavailable",
          inputs: [],
          outputs: [],
        });
        const error = yield* Effect.flip(runtime.MidiSend({ outputId, data: [0x90, 1, 1] }));
        assert.strictEqual(error.reason, "Native MIDI support is unavailable");
      }),
    ),
  );
});
