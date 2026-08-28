import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect, Result } from "effect";

import { hexToColor } from "../src/Color.ts";
import { LIFXFailure, LIFXLight } from "../src/Definition.ts";
import plugin from "../src/Plugin.ts";
import { device } from "./Fixtures.ts";

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

describe("LIFX registration", () => {
  it.effect("registers six schemas and maps each setter to its engine RPC/resource", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      assert.deepStrictEqual(
        schemas.map(({ id }) => id),
        [
          "SetLightPower",
          "SetLightColor",
          "SetBrightness",
          "SetKelvin",
          "GetLightState",
          "HexToColor",
        ],
      );
      const cases: Array<[string, Record<string, unknown>, string, unknown]> = [
        [
          "SetLightPower",
          { power: true, duration: 1000 },
          "LIFXSetPower",
          { deviceId: device.id, power: true, duration: 1000 },
        ],
        [
          "SetLightColor",
          { hue: 180, saturation: 50, brightness: 25, kelvin: 3500, duration: 1000 },
          "LIFXSetColor",
          {
            deviceId: device.id,
            color: { hue: 180, saturation: 50, brightness: 25, kelvin: 3500 },
            duration: 1000,
          },
        ],
        [
          "SetBrightness",
          { brightness: 25, duration: 1000 },
          "LIFXSetBrightness",
          { deviceId: device.id, brightness: 25, duration: 1000 },
        ],
        [
          "SetKelvin",
          { kelvin: 4000, brightness: 50, duration: 0 },
          "LIFXSetKelvin",
          { deviceId: device.id, kelvin: 4000, brightness: 50, duration: 0 },
        ],
      ];
      for (const [id, inputs, rpc, expected] of cases) {
        const schema = schemas.find((schema) => schema.id === id)!;
        assert.deepStrictEqual(
          schema.properties.map((property) =>
            "resource" in property ? property.resource : undefined,
          ),
          [LIFXLight.key],
        );
        const sent: unknown[] = [];
        yield* schema.run({
          input: (ref) => inputs[ref.id],
          output: () => undefined,
          properties: { light: device.id },
          event: undefined,
          engine: {
            [rpc]: (payload: unknown) =>
              Effect.sync(() => {
                sent.push(payload);
              }),
          },
          execution,
          node,
        });
        assert.deepStrictEqual(sent, [expected]);
      }
    }),
  );
  it.effect(
    "emits every state/conversion output and propagates errors without writing outputs",
    () =>
      Effect.gen(function* () {
        const schemas = yield* Registration.collect(plugin.effect);
        const state = {
          label: "Desk",
          power: true,
          hue: 180,
          saturation: 50,
          brightness: 25,
          kelvin: 3500,
          hex: "#204040",
        };
        const outputs: Record<string, unknown> = {};
        const base = {
          output: (ref: { id: string }, value: unknown) => {
            outputs[ref.id] = value;
          },
          properties: { light: device.id },
          event: undefined,
          execution,
          node,
        };
        yield* schemas
          .find((schema) => schema.id === "GetLightState")!
          .run({
            ...base,
            input: () => undefined,
            engine: {
              LIFXGetState: (payload: unknown) => {
                assert.deepStrictEqual(payload, { deviceId: device.id });
                return Effect.succeed(state);
              },
            },
          });
        assert.deepStrictEqual(outputs, state);
        const conversion = schemas.find((schema) => schema.id === "HexToColor")!;
        assert.deepStrictEqual(conversion.properties, []);
        const converted: Record<string, unknown> = {};
        yield* conversion.run({
          ...base,
          properties: {},
          input: () => "#00f",
          output: (ref, value) => {
            converted[ref.id] = value;
          },
          engine: {},
        });
        assert.deepStrictEqual(converted, yield* hexToColor("#00f"));
        const invalid = yield* Effect.result(
          conversion.run({
            ...base,
            properties: {},
            input: () => "#zzzzzz",
            output: () => assert.fail("Invalid hex must not write outputs"),
            engine: {},
          }),
        );
        assert.isTrue(Result.isFailure(invalid));
        const failure = new LIFXFailure({ reason: "Timed out" });
        const failed = yield* Effect.result(
          schemas
            .find((schema) => schema.id === "GetLightState")!
            .run({
              ...base,
              input: () => undefined,
              output: () => assert.fail("Failed requests must not write outputs"),
              engine: { LIFXGetState: () => Effect.fail(failure) },
            }),
        );
        assert.isTrue(Result.isFailure(failed));
        if (Result.isFailure(failed)) assert.strictEqual(failed.failure, failure);
      }),
  );
});
