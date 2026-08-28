import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect, Option, Result } from "effect";

import { IkeaFailure, IkeaLight, LightId } from "../src/Definition.ts";
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
describe("IKEA TRADFRI catalog", () => {
  it.effect("registers exactly six working schemas, not a fake LightStateChanged event", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      assert.deepStrictEqual(
        schemas.map((s) => s.id),
        [
          "SetLightState",
          "SetBrightness",
          "SetColorTemperature",
          "SetColor",
          "ListLights",
          "GetLightState",
        ],
      );
      assert.strictEqual(plugin.id, "ikea-tradfri");
      assert.strictEqual(plugin.name, "IKEA TRADFRI Gateway");
      assert.isDefined(deployment);
      for (const schema of schemas.filter((s) => s.id !== "ListLights"))
        assert.deepStrictEqual(
          schema.properties.map((p) => ("resource" in p ? p.resource : undefined)),
          [IkeaLight.key],
        );
    }),
  );
  it.effect(
    "routes controls and forwards fresh state/JSON with absent capabilities as options",
    () =>
      Effect.gen(function* () {
        const schemas = yield* Registration.collect(plugin.effect);
        const id = LightId.make(1);
        const light = { id, name: "Desk", reachable: true, on: false, brightness: 0 };
        const cases: Array<[string, Record<string, unknown>, unknown]> = [
          ["SetLightState", { state: false }, { lightId: id, state: { on: false } }],
          ["SetBrightness", { brightness: 20 }, { lightId: id, state: { brightness: 20 } }],
          ["SetColorTemperature", { colorTemp: 2700 }, { lightId: id, state: { colorTemp: 2700 } }],
          ["SetColor", { hexColor: "ffffff" }, { lightId: id, state: { hexColor: "ffffff" } }],
          ["ListLights", {}, undefined],
          ["GetLightState", {}, { lightId: id }],
        ];
        for (const [schemaId, inputs, expectedCall] of cases) {
          const calls: unknown[] = [];
          const outputs: Record<string, unknown> = {};
          const handler = (payload: unknown) =>
            Effect.sync(() => {
              calls.push(payload);
              return light;
            });
          yield* schemas
            .find((s) => s.id === schemaId)!
            .run({
              input: (ref) => inputs[ref.id],
              output: (ref, value) => {
                outputs[ref.id] = value;
              },
              properties: { light: id },
              event: undefined,
              execution,
              node,
              engine: {
                IkeaSetLightState: handler,
                IkeaGetLightState: handler,
                IkeaListLights: (payload: unknown) =>
                  handler(payload).pipe(Effect.map((light) => [light])),
              },
            });
          assert.deepStrictEqual(calls, [expectedCall]);
          if (schemaId === "GetLightState")
            assert.deepStrictEqual(outputs, {
              deviceName: "Desk",
              reachable: true,
              on: false,
              brightness: 0,
              colorTemp: Option.none(),
              hexColor: Option.none(),
            });
          else if (schemaId === "ListLights")
            assert.deepStrictEqual(outputs, { lights: JSON.stringify([light]) });
          else assert.deepStrictEqual(outputs, {});
        }
      }),
  );
  it.effect("propagates gateway errors without cached or fabricated outputs", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      const failure = new IkeaFailure({ reason: "Gateway unavailable." });
      for (const schema of schemas) {
        const fail = () => Effect.fail(failure);
        const result = yield* Effect.result(
          schema.run({
            input: () => 0,
            output: () => assert.fail("Must not emit success"),
            properties: { light: LightId.make(1) },
            event: undefined,
            execution,
            node,
            engine: { IkeaListLights: fail, IkeaGetLightState: fail, IkeaSetLightState: fail },
          }),
        );
        assert.isTrue(Result.isFailure(result));
      }
    }),
  );
});
