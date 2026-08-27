import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect } from "effect";

import { ClientRpcs } from "../src/Definition.ts";
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
describe("Voicemod catalog", () => {
  it("namespaces its globally merged settings RPCs", () => {
    assert.deepStrictEqual(
      [...ClientRpcs.requests.keys()],
      ["VoicemodConfigure", "VoicemodConnect", "VoicemodDisconnect"],
    );
  });
  it.effect("registers exactly three actions and forwards their string and boolean pins", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      assert.deepStrictEqual(
        schemas.map((schema) => schema.id),
        [...ids],
      );
      assert.strictEqual(new Set(schemas.map((schema) => schema.id)).size, 3);
      for (const schema of schemas) {
        assert.isDefined(schema.description);
        assert.deepStrictEqual(
          schema.executionOutputs.map((output) => output.id),
          ["exec"],
        );
        assert.strictEqual(schema.dataInputs.length, 1);
        assert.strictEqual(
          schema.dataInputs[0]?.type._tag,
          schema.id === "SetVoice" ? "String" : "Bool",
        );
        const calls: unknown[] = [];
        const record = (payload: unknown) =>
          Effect.sync(() => {
            calls.push(payload);
          });
        yield* schema.run({
          input: () => (schema.id === "SetVoice" ? "Baby" : true),
          output: () => undefined,
          properties: {},
          event: undefined,
          engine: { SetVoice: record, SetVoiceChangerState: record, SetHearSelfState: record },
          execution,
          node,
        });
        assert.deepStrictEqual(calls, [
          schema.id === "SetVoice" ? { voice: "Baby" } : { state: true },
        ]);
      }
    }),
  );
});
