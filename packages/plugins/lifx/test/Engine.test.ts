import { assert, describe, it } from "@effect/vitest";
import { EngineTest } from "@macrograph/plugin";
import { Deferred, Effect, Fiber, Layer, Result } from "effect";
import { Buffer } from "node:buffer";

import {
  DeviceId,
  initialStorage,
  LIFXEngine,
  LIFXFailure,
  LIFXLight,
  type RuntimeStorage,
} from "../src/Definition.ts";
import { layer } from "../src/Engine.ts";
import { parseState } from "../src/Protocol.ts";
import { Transport } from "../src/Transport.ts";
import { device, statePayload } from "./Fixtures.ts";

const harness = Effect.fnUntraced(function* (options?: {
  readonly storage?: typeof RuntimeStorage.Type;
  readonly exchange?: typeof Transport.Service.exchange;
}) {
  let storage = options?.storage ?? { devices: [device], timeout: 2000 };
  const sent: Array<{ type: number; payload: Buffer; timeout: number }> = [];
  let clientRefreshes = 0,
    resourceRefreshes = 0;
  const context = Layer.succeed(LIFXEngine.EngineContext)({
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
    client: {
      refresh: Effect.sync(() => {
        clientRefreshes++;
      }),
    },
    credentials: {
      get: Effect.succeed([]),
      refresh: () => Effect.die("No credentials"),
      subscribe: () => Effect.void,
    },
    emit: () => Effect.void,
  });
  const transport = Layer.succeed(Transport)({
    exchange:
      options?.exchange ??
      ((_device, type, payload, _responseType, timeout) =>
        Effect.sync(() => {
          sent.push({ type, payload, timeout });
          return type === 101 ? statePayload() : Buffer.alloc(0);
        })),
  });
  const built = yield* Layer.build(layer.pipe(Layer.provide(Layer.merge(context, transport))));
  const clients = yield* EngineTest.makeClients(LIFXEngine).pipe(Effect.provideContext(built));
  return {
    ...clients,
    sent,
    storage: () => storage,
    clientRefreshes: () => clientRefreshes,
    resourceRefreshes: () => resourceRefreshes,
  };
});

describe("LIFX engine", () => {
  it.effect("preserves newer bulbs' warmer kelvin values when changing brightness", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const payload = statePayload();
        payload.writeUInt16LE(1500, 6);
        const written: Buffer[] = [];
        const h = yield* harness({
          exchange: (_device, type, outgoing) =>
            Effect.sync(() => {
              if (type === 101) return payload;
              written.push(outgoing);
              return Buffer.alloc(0);
            }),
        });
        yield* h.runtime.LIFXSetBrightness({ deviceId: device.id, brightness: 25, duration: 0 });
        assert.strictEqual(written[0]!.readUInt16LE(7), 1500);
      }),
    ),
  );
  it.effect(
    "mounts and configures inertly, persists normalized resources and refreshes client state",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness({ storage: initialStorage });
          assert.deepStrictEqual(yield* h.engine.client.state, initialStorage);
          assert.strictEqual(h.sent.length, 0);
          yield* h.client.LIFXConfigure({
            devices: [{ ...device, id: DeviceId.make(device.id.toUpperCase()), name: " Desk " }],
            timeout: 1234,
          });
          assert.deepStrictEqual(h.storage(), { devices: [device], timeout: 1234 });
          assert.strictEqual(h.clientRefreshes(), 1);
          assert.strictEqual(h.resourceRefreshes(), 1);
          assert.deepStrictEqual(yield* LIFXLight.values.pipe(Effect.provide(h.engine.resources)), [
            { id: device.id, display: "Desk" },
          ]);
          assert.strictEqual(h.sent.length, 0);
          yield* h.client.LIFXConfigure(initialStorage);
          assert.deepStrictEqual(yield* h.engine.client.state, initialStorage);
        }),
      ),
  );
  it.effect("gets state and sends exact power/color operations with configured timeouts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* harness({ storage: { devices: [device], timeout: 1234 } });
        assert.deepStrictEqual(
          yield* h.runtime.LIFXGetState({ deviceId: device.id }),
          yield* parseState(statePayload()),
        );
        yield* h.runtime.LIFXSetPower({ deviceId: device.id, power: true, duration: 1000 });
        yield* h.runtime.LIFXSetPower({ deviceId: device.id, power: false, duration: 0 });
        yield* h.runtime.LIFXSetColor({
          deviceId: device.id,
          color: { hue: 180, saturation: 100, brightness: 50, kelvin: 3500 },
          duration: 1000,
        });
        assert.deepStrictEqual(
          h.sent.map(({ type, payload, timeout }) => [type, payload.toString("hex"), timeout]),
          [
            [101, "", 1234],
            [117, "ffffe8030000", 1234],
            [117, "000000000000", 1234],
            [102, "000080ffff0080ac0de8030000", 1234],
          ],
        );
      }),
    ),
  );
  it.effect(
    "preserves exact raw hue/saturation/kelvin on brightness updates and hue on kelvin updates",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness();
          yield* h.runtime.LIFXSetBrightness({
            deviceId: device.id,
            brightness: 25,
            duration: 1000,
          });
          yield* h.runtime.LIFXSetKelvin({
            deviceId: device.id,
            brightness: 50,
            kelvin: 4000,
            duration: 0,
          });
          assert.deepStrictEqual(
            h.sent.map(({ type }) => type),
            [101, 102, 101, 102],
          );
          const brightness = h.sent[1]!.payload,
            kelvin = h.sent[3]!.payload;
          assert.deepStrictEqual(
            [
              brightness.readUInt16LE(1),
              brightness.readUInt16LE(3),
              brightness.readUInt16LE(5),
              brightness.readUInt16LE(7),
              brightness.readUInt32LE(9),
            ],
            [12345, 23456, 16384, 3500, 1000],
          );
          assert.deepStrictEqual(
            [
              kelvin.readUInt16LE(1),
              kelvin.readUInt16LE(3),
              kelvin.readUInt16LE(5),
              kelvin.readUInt16LE(7),
              kelvin.readUInt32LE(9),
            ],
            [12345, 0, 32768, 4000, 0],
          );
        }),
      ),
  );
  it.effect(
    "fails unknown targets, invalid persisted settings and input ranges before sending",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* harness();
          const calls = [
            h.runtime.LIFXGetState({ deviceId: DeviceId.make("d0:73:d5:00:00:00") }),
            h.runtime.LIFXSetPower({ deviceId: device.id, power: true, duration: -1 }),
            h.runtime.LIFXSetColor({
              deviceId: device.id,
              color: { hue: 361, saturation: 0, brightness: 100, kelvin: 3500 },
              duration: 0,
            }),
            h.runtime.LIFXSetBrightness({ deviceId: device.id, brightness: 101, duration: 0 }),
            h.runtime.LIFXSetBrightness({ deviceId: device.id, brightness: 50, duration: -1 }),
            h.runtime.LIFXSetKelvin({
              deviceId: device.id,
              brightness: 50,
              kelvin: 1000,
              duration: 0,
            }),
            h.runtime.LIFXSetKelvin({
              deviceId: device.id,
              brightness: 101,
              kelvin: 3500,
              duration: 0,
            }),
            h.client.LIFXConfigure({
              devices: [{ ...device, address: "localhost" }],
              timeout: 2000,
            }),
            h.client.LIFXConfigure({ devices: [device, device], timeout: 2000 }),
          ];
          for (const call of calls) assert.isTrue(Result.isFailure(yield* Effect.result(call)));
          assert.strictEqual(h.sent.length, 0);
          assert.deepStrictEqual(h.storage(), { devices: [device], timeout: 2000 });
          for (const storage of [
            { devices: [{ ...device, port: 0 }], timeout: 2000 },
            { devices: [device], timeout: 0 },
          ]) {
            const invalid = yield* harness({ storage });
            assert.isTrue(
              Result.isFailure(
                yield* Effect.result(invalid.runtime.LIFXGetState({ deviceId: device.id })),
              ),
            );
            assert.strictEqual(invalid.sent.length, 0);
          }
        }),
      ),
  );
  it.effect(
    "propagates transport failures and never sends a partial update after a failed read",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const sent: number[] = [],
            failure = new LIFXFailure({ reason: "Bulb unreachable" });
          const h = yield* harness({
            exchange: (_device, type) =>
              Effect.sync(() => {
                sent.push(type);
              }).pipe(Effect.andThen(Effect.fail(failure))),
          });
          const result = yield* Effect.result(
            h.runtime.LIFXSetBrightness({ deviceId: device.id, brightness: 50, duration: 0 }),
          );
          assert.isTrue(Result.isFailure(result));
          if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, failure.reason);
          assert.deepStrictEqual(sent, [101]);
          assert.isTrue(
            Result.isFailure(
              yield* Effect.result(
                h.runtime.LIFXSetPower({ deviceId: device.id, power: true, duration: 0 }),
              ),
            ),
          );
          assert.deepStrictEqual(sent, [101, 117]);
        }),
      ),
  );
  it.effect("serializes read-modify-write and configuration; interruption releases the lock", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>(),
          release = yield* Deferred.make<void>();
        const sent: number[] = [];
        let first = true;
        const h = yield* harness({
          exchange: (_device, type) =>
            Effect.gen(function* () {
              sent.push(type);
              if (first) {
                first = false;
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(release);
              }
              return type === 101 ? statePayload() : Buffer.alloc(0);
            }),
        });
        const brightness = yield* h.runtime
          .LIFXSetBrightness({ deviceId: device.id, brightness: 50, duration: 0 })
          .pipe(Effect.forkChild);
        yield* Deferred.await(started);
        const power = yield* h.runtime
          .LIFXSetPower({ deviceId: device.id, power: true, duration: 0 })
          .pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        assert.deepStrictEqual(sent, [101]);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(brightness);
        yield* Fiber.join(power);
        assert.deepStrictEqual(sent, [101, 102, 117]);

        const paused = yield* Deferred.make<void>();
        const blocking = yield* harness({
          exchange: () => Deferred.succeed(paused, undefined).pipe(Effect.andThen(Effect.never)),
        });
        const request = yield* blocking.runtime
          .LIFXGetState({ deviceId: device.id })
          .pipe(Effect.forkChild);
        yield* Deferred.await(paused);
        const update = yield* blocking.client.LIFXConfigure(initialStorage).pipe(Effect.forkChild);
        yield* Effect.yieldNow;
        assert.strictEqual(blocking.storage().devices.length, 1);
        yield* Fiber.interrupt(request);
        yield* Fiber.join(update);
        assert.deepStrictEqual(blocking.storage(), initialStorage);
      }),
    ),
  );
});
