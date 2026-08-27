import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import {
  NotConnected,
  WebSocketClientEngine,
  ClientRpcs as BaseClientRpcs,
} from "@macrograph/plugin-websocket-client/Definition";
import { Effect, Result } from "effect";

import {
  ClientRpcs,
  ConnectionId,
  SpeakerBotConnection,
  SpeakerBotEngine,
} from "../src/Definition.ts";
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

describe("SpeakerBot", () => {
  it.effect("sends every exact legacy payload including both toggle states", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      assert.strictEqual(schemas.length, 6);
      const id = ConnectionId.make("speaker");
      const cases: Array<[string, Record<string, unknown>, string]> = [
        [
          "Speak",
          { voice: "Brian", message: 'Hello "world"' },
          '{"voice":"Brian","message":"Hello \\"world\\"","id":"Macrograph","request":"Speak"}',
        ],
        ["StopCurrent", {}, '{"id":"Macrograph","request":"Stop"}'],
        ["QueueClear", {}, '{"id":"Macrograph","request":"Clear"}'],
        ["ToggleTTS", { state: true }, '{"id":"Macrograph","request":"Enable"}'],
        ["ToggleTTS", { state: false }, '{"id":"Macrograph","request":"Disable"}'],
        ["QueueToggle", { state: true }, '{"id":"Macrograph","request":"Pause"}'],
        ["QueueToggle", { state: false }, '{"id":"Macrograph","request":"Resume"}'],
        ["EventsToggle", { state: true }, '{"id":"Macrograph","request":"Events","state":"on"}'],
        ["EventsToggle", { state: false }, '{"id":"Macrograph","request":"Events","state":"off"}'],
      ];
      for (const [schemaId, inputs, data] of cases) {
        const schema = schemas.find((schema) => schema.id === schemaId)!;
        assert.deepStrictEqual(
          schema.properties.map((property) =>
            "resource" in property ? property.resource : undefined,
          ),
          [SpeakerBotConnection.key],
        );
        const sent: unknown[] = [];
        yield* schema.run({
          input: (ref) => inputs[ref.id],
          output: () => undefined,
          properties: { connection: id },
          event: undefined,
          engine: {
            SpeakerBotWebSocketSendMessage: (payload: unknown) =>
              Effect.sync(() => {
                sent.push(payload);
              }),
          },
          execution,
          node,
        });
        assert.deepStrictEqual(sent, [{ connectionId: id, data }]);
      }
    }),
  );
  it.effect("propagates transport failure and has independent engine/RPC keys", () =>
    Effect.gen(function* () {
      assert.notStrictEqual(SpeakerBotEngine.key, WebSocketClientEngine.key);
      for (const tag of ClientRpcs.requests.keys())
        assert.isFalse(BaseClientRpcs.requests.has(tag));
      const schemas = yield* Registration.collect(plugin.effect);
      const id = ConnectionId.make("speaker");
      const failure = new NotConnected({ id });
      const result = yield* Effect.result(
        schemas
          .find((schema) => schema.id === "StopCurrent")!
          .run({
            input: () => undefined,
            output: () => undefined,
            properties: { connection: id },
            event: undefined,
            engine: { SpeakerBotWebSocketSendMessage: () => Effect.fail(failure) },
            execution,
            node,
          }),
      );
      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) assert.strictEqual(result.failure, failure);
    }),
  );
});
