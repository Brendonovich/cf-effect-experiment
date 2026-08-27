import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect } from "effect";

import {
  ClientRpcs,
  ConnectionFailed,
  RequestFailed,
  VTubeStudioInstance,
} from "../src/Definition.ts";
import plugin, { ids } from "../src/Plugin.ts";

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
describe("VTube Studio catalog", () => {
  it.effect("suggests live pin values from the selected instance and propagates failures", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      const cases = [
        {
          id: "LoadModel",
          pin: "model",
          requestType: "AvailableModels",
          data: {},
          list: "availableModels",
          value: "modelID",
          item: { modelID: "model-1", modelName: "Model One" },
          expected: "model-1",
          reason: "Invalid model list.",
        },
        {
          id: "ToggleExpression",
          pin: "file",
          requestType: "ExpressionState",
          data: { details: false },
          list: "expressions",
          value: "file",
          item: { file: "smile.exp3.json", name: "Smile" },
          expected: "smile.exp3.json",
          reason: "Invalid expression list.",
        },
        {
          id: "ExecuteHotkey",
          pin: "id",
          requestType: "HotkeysInCurrentModel",
          data: {},
          list: "availableHotkeys",
          value: "hotkeyID",
          item: { hotkeyID: "hotkey-1", name: "Smile" },
          expected: "hotkey-1",
          reason: "Invalid hotkey list.",
        },
      ];
      for (const test of cases) {
        const schema = schemas.find((schema) => schema.id === test.id);
        assert.isDefined(schema);
        const suggestions = schema
          .generateIO({ instance: "ws://127.0.0.1:8001/" })
          .dataInputs.find((input) => input.id === test.pin)?.suggestions;
        assert.isDefined(suggestions);
        const calls: unknown[] = [];
        let response: Record<string, unknown> = { [test.list]: [test.item] };
        const engine = {
          Call: (payload: unknown) =>
            Effect.sync(() => {
              calls.push(payload);
              return response;
            }),
        };
        for (const instance of ["ws://127.0.0.1:8002/", "ws://127.0.0.1:8003/"]) {
          assert.deepStrictEqual(
            yield* suggestions({ properties: { instance }, inputDefaults: {}, engine }),
            [test.expected],
          );
          assert.deepStrictEqual(calls.at(-1), {
            url: instance,
            requestType: test.requestType,
            data: test.data,
          });
        }
        const context = {
          properties: { instance: "ws://127.0.0.1:8002/" },
          inputDefaults: {},
          engine,
        };
        response = { [test.list]: [] };
        assert.deepStrictEqual(yield* suggestions(context), []);
        for (const invalid of [
          undefined,
          null,
          {},
          [{ name: "Missing ID" }],
          [{ [test.value]: 123 }],
        ]) {
          response = { [test.list]: invalid };
          assert.deepStrictEqual(
            yield* Effect.flip(suggestions(context)),
            new RequestFailed({ requestType: test.requestType, reason: test.reason }),
          );
        }
        for (const failure of [
          new ConnectionFailed({ reason: "Disconnected" }),
          new RequestFailed({ requestType: test.requestType, reason: "Rejected", code: 50 }),
        ]) {
          assert.strictEqual(
            yield* Effect.flip(
              suggestions({ ...context, engine: { Call: () => Effect.fail(failure) } }),
            ),
            failure,
          );
        }
      }
    }),
  );
  it("namespaces its globally merged settings RPCs", () => {
    assert.deepStrictEqual(
      [...ClientRpcs.requests.keys()],
      ["VTubeStudioConfigure", "VTubeStudioConnect", "VTubeStudioDisconnect"],
    );
  });
  it.effect("preserves all six actions and primitive pins, forwarding exact protocol data", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      assert.deepStrictEqual(
        schemas.map((schema) => schema.id),
        [...ids],
      );
      assert.strictEqual(new Set(schemas.map((schema) => schema.id)).size, 6);
      const cases = [
        {
          id: "AvailableModels",
          type: "AvailableModels",
          input: {},
          data: {},
          response: { availableModels: [{ modelID: "m" }] },
          output: { models: '[{"modelID":"m"}]' },
        },
        {
          id: "LoadModel",
          type: "ModelLoad",
          input: { model: "m" },
          data: { modelID: "m" },
          response: {},
          output: {},
        },
        {
          id: "ExpressionState",
          type: "ExpressionState",
          input: {},
          data: { details: false },
          response: { expressions: [{ file: "smile.exp3.json" }] },
          output: { expressions: '[{"file":"smile.exp3.json"}]' },
        },
        {
          id: "ToggleExpression",
          type: "ExpressionActivation",
          input: { file: "smile.exp3.json", active: true },
          data: { expressionFile: "smile.exp3.json", active: true },
          response: {},
          output: {},
        },
        {
          id: "GetHotkeyList",
          type: "HotkeysInCurrentModel",
          input: {},
          data: {},
          response: { availableHotkeys: [{ hotkeyID: "h" }] },
          output: { hotkeys: '[{"hotkeyID":"h"}]' },
        },
        {
          id: "ExecuteHotkey",
          type: "HotkeyTrigger",
          input: { id: "h" },
          data: { hotkeyID: "h" },
          response: {},
          output: {},
        },
      ];
      for (const test of cases) {
        const schema = schemas.find((schema) => schema.id === test.id);
        assert.isDefined(schema);
        assert.isDefined(schema.description);
        assert.deepStrictEqual(
          schema.executionOutputs.map((output) => output.id),
          ["exec"],
        );
        assert.isTrue(schema.dataOutputs.every((output) => output.type._tag === "String"));
        assert.isTrue(
          schema.dataInputs.every(
            (input) => input.type._tag === "String" || input.type._tag === "Bool",
          ),
        );
        assert.strictEqual(schema.properties[0]?.id, "instance");
        assert.isTrue(
          "resource" in schema.properties[0]! &&
            schema.properties[0].resource === VTubeStudioInstance.key,
        );
        const inputs = new Map<string, unknown>(Object.entries(test.input));
        const outputs = new Map<string, unknown>();
        const calls: unknown[] = [];
        yield* schema.run({
          input: (ref) => inputs.get(ref.id),
          output: (ref, value) => outputs.set(ref.id, value),
          properties: { instance: "ws://127.0.0.1:8001" },
          event: undefined,
          engine: {
            Call: (payload: unknown) =>
              Effect.sync(() => {
                calls.push(payload);
                return test.response;
              }),
          },
          execution,
          node,
        });
        assert.deepStrictEqual(calls, [
          { url: "ws://127.0.0.1:8001", requestType: test.type, data: test.data },
        ]);
        assert.deepStrictEqual(Object.fromEntries(outputs), test.output);
      }
    }),
  );
});
