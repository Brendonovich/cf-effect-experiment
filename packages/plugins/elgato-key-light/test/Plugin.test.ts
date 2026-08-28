import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect, Result } from "effect";

import { DeviceId, KeyLightDevice, KeyLightFailure } from "../src/Definition.ts";
import deployment from "../src/Deployment.ts";
import plugin from "../src/Plugin.ts";

const execution = {
  projectId: "project",
  graphId: "graph",
  eventNodeId: "event",
  traceId: "trace",
};
const node = {
  nodeId: "node",
  kind: "exec" as const,
  executionPath: "node",
  traceId: "trace",
  withSpan: <A, E, R>(_name: string, effect: Effect.Effect<A, E, R>) => effect,
};

describe("Key Light catalog", () => {
  it.effect("registers ten unique nodes with real deployment metadata and device resources", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      assert.deepStrictEqual(
        schemas.map((schema) => schema.id),
        [
          "GetState",
          "SetState",
          "Toggle",
          "IncrementBrightness",
          "IncrementTemperature",
          "SetBrightness",
          "SetTemperature",
          "BrightnessToPercent",
          "KelvinToMireds",
          "MiredsToKelvin",
        ],
      );
      assert.strictEqual(plugin.id, "elgato-key-light");
      assert.isDefined(deployment);
      for (const schema of schemas.slice(0, 7))
        assert.deepStrictEqual(
          schema.properties.map((property) =>
            "resource" in property ? property.resource : undefined,
          ),
          [KeyLightDevice.key],
        );
      for (const schema of schemas.slice(7)) {
        assert.strictEqual(schema.type, "pure");
        assert.deepStrictEqual(schema.properties, []);
      }
    }),
  );

  it.effect("routes every control node through typed runtime RPCs and forwards outputs", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      const deviceId = DeviceId.make("desk");
      const state = { on: true, brightness: 42, kelvin: 4000 };
      const cases: Array<[string, Record<string, unknown>, unknown, Record<string, unknown>]> = [
        ["GetState", {}, { deviceId }, { on: true, brightness: 42, kelvin: 4000 }],
        [
          "SetState",
          { on: false, brightness: 50, temperature: 4500 },
          {
            deviceId,
            operation: { type: "set", state: { on: false, brightness: 50, kelvin: 4500 } },
          },
          {},
        ],
        ["Toggle", {}, { deviceId, operation: { type: "toggle" } }, { on: true }],
        [
          "IncrementBrightness",
          { delta: -5 },
          { deviceId, operation: { type: "brightness", delta: -5 } },
          { brightness: 42 },
        ],
        [
          "IncrementTemperature",
          { delta: 500 },
          { deviceId, operation: { type: "temperature", delta: 500 } },
          { kelvin: 4000 },
        ],
        [
          "SetBrightness",
          { brightness: 80 },
          { deviceId, operation: { type: "set", state: { brightness: 80 } } },
          {},
        ],
        [
          "SetTemperature",
          { kelvin: 5000 },
          { deviceId, operation: { type: "set", state: { kelvin: 5000 } } },
          {},
        ],
      ];
      for (const [schemaId, inputs, payload, expected] of cases) {
        const calls: unknown[] = [];
        const outputs: Record<string, unknown> = {};
        const handler = (payload: unknown) =>
          Effect.sync(() => {
            calls.push(payload);
            return state;
          });
        yield* schemas
          .find((schema) => schema.id === schemaId)!
          .run({
            input: (ref) => inputs[ref.id],
            output: (ref, value) => {
              outputs[ref.id] = value;
            },
            properties: { light: deviceId },
            event: undefined,
            execution,
            node,
            engine: { ElgatoKeyLightGetState: handler, ElgatoKeyLightUpdateState: handler },
          });
        assert.deepStrictEqual(calls, [payload]);
        assert.deepStrictEqual(outputs, expected);
      }
    }),
  );

  it.effect("runs conversions without transport and rejects invalid ranges", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      for (const [id, value, expected] of [
        ["BrightnessToPercent", 50, 50],
        ["KelvinToMireds", 4500, 222],
        ["KelvinToMireds", 2900, 344],
        ["MiredsToKelvin", 222, 4505],
      ] as const) {
        const outputs: unknown[] = [];
        yield* schemas
          .find((schema) => schema.id === id)!
          .run({
            input: () => value,
            output: (_ref, value) => {
              outputs.push(value);
            },
            properties: {},
            event: undefined,
            engine: {},
            execution,
            node,
          });
        assert.deepStrictEqual(outputs, [expected]);
      }
      for (const [id, value] of [
        ["BrightnessToPercent", -1],
        ["BrightnessToPercent", 101],
        ["BrightnessToPercent", 1.5],
        ["KelvinToMireds", 0],
        ["KelvinToMireds", Infinity],
        ["MiredsToKelvin", NaN],
        ["MiredsToKelvin", 345],
      ] as const) {
        const result = yield* Effect.result(
          schemas
            .find((schema) => schema.id === id)!
            .run({
              input: () => value,
              output: () => assert.fail("Invalid values must not emit outputs"),
              properties: {},
              event: undefined,
              engine: {},
              execution,
              node,
            }),
        );
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.instanceOf(result.failure, KeyLightFailure);
      }
    }),
  );

  it.effect("propagates HTTP failures without emitting fabricated state", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      const failure = new KeyLightFailure({ reason: "HTTP 503" });
      for (const schema of schemas.slice(0, 7)) {
        const result = yield* Effect.result(
          schema.run({
            input: () => 0,
            output: () => assert.fail("Failure must not emit state"),
            properties: { light: DeviceId.make("desk") },
            event: undefined,
            execution,
            node,
            engine: {
              ElgatoKeyLightGetState: () => Effect.fail(failure),
              ElgatoKeyLightUpdateState: () => Effect.fail(failure),
            },
          }),
        );
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.strictEqual(result.failure, failure);
      }
    }),
  );
});
