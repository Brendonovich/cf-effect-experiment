import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect, Result } from "effect";

import {
  ButtonState,
  ChannelMuteState,
  type Command,
  ConnectionId,
  DialState,
  GoXLRConnection,
  GoXLRFailure,
  LevelChange,
} from "../src/Definition.ts";
import plugin from "../src/Plugin.ts";
import { commandRequest, decodeResponse, patchEvents, statusRequest } from "../src/Protocol.ts";
import { broadcastPatch } from "./Fixtures.ts";

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
const id = ConnectionId.make("goxlr");

describe("GoXLR protocol and schemas", () => {
  it.effect("accepts the broadcast sentinel and rejects unsafe or non-amount numeric events", () =>
    Effect.gen(function* () {
      const response = yield* decodeResponse(broadcastPatch);
      assert.isFalse(Number.isSafeInteger(response.id));
      assert.isTrue(Number.isFinite(response.id));
      if (typeof response.data !== "object" || !("Patch" in response.data))
        return yield* Effect.die("Expected a patch");
      assert.deepStrictEqual(patchEvents(id, "other", response.data.Patch), [
        new LevelChange({ connectionId: id, channel: "Music", value: 13 }),
        new ButtonState({ connectionId: id, buttonName: "Fader1Mute", state: true }),
        new DialState({ connectionId: id, dial: "reverb", amount: 22 }),
        new ChannelMuteState({ connectionId: id, channel: "A", state: true }),
      ]);
      assert.deepStrictEqual(
        patchEvents(
          id,
          "other",
          [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1].flatMap((value) => [
            { op: "replace" as const, path: "/mixers/other/levels/volumes/Music", value },
            { op: "replace" as const, path: "/mixers/other/effects/current/reverb/amount", value },
          ]),
        ),
        [],
      );
    }),
  );
  it.effect("sends all exact legacy command payloads and validates enum string inputs", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      assert.strictEqual(schemas.length, 13);
      const cases: Array<[string, Record<string, unknown>, Command]> = [
        ["MuteSlider", { Slider: "A", muteState: true }, { SetFaderMuteState: ["A", "MutedToX"] }],
        ["MuteSlider", { Slider: "D", muteState: false }, { SetFaderMuteState: ["D", "Unmuted"] }],
        ["SetMicrophoneType", { micType: "Condenser" }, { SetMicrophoneType: "Condenser" }],
        ["SetReverbAmount", { amount: 20 }, { SetReverbAmount: 20 }],
        ["SetEchoAmount", { amount: 30 }, { SetEchoAmount: 30 }],
        ["SetPitchAmount", { amount: -12 }, { SetPitchAmount: -12 }],
        ["SetGenderAmount", { amount: 40 }, { SetGenderAmount: 40 }],
        ["SetFXState", { state: true }, { SetFXEnabled: true }],
        ["SetFXState", { state: false }, { SetFXEnabled: false }],
        ["SetFXPreset", { preset: "Preset6" }, { SetActiveEffectPreset: "Preset6" }],
        [
          "SetRouteState",
          { input: "Music", output: "Headphones", state: true },
          { SetRouter: ["Music", "Headphones", true] },
        ],
        [
          "SetRouteState",
          { input: "Microphone", output: "BroadcastMix", state: false },
          { SetRouter: ["Microphone", "BroadcastMix", false] },
        ],
      ];
      assert.strictEqual(statusRequest, '{"id":0,"data":"GetStatus"}');
      for (const [schemaId, inputs, command] of cases) {
        const sent: string[] = [];
        yield* schemas
          .find((schema) => schema.id === schemaId)!
          .run({
            input: (ref) => inputs[ref.id],
            output: () => undefined,
            properties: { connection: id },
            event: undefined,
            engine: {
              GoXLRCommand: (payload: { connectionId: ConnectionId; command: Command }) =>
                Effect.sync(() => {
                  assert.strictEqual(payload.connectionId, id);
                  sent.push(commandRequest("serial", payload.command));
                }),
            },
            execution,
            node,
          });
        assert.deepStrictEqual(sent, [
          JSON.stringify({ id: 0, data: { Command: ["serial", command] } }),
        ]);
      }
      for (const [schemaId, inputs] of [
        ["MuteSlider", { Slider: "E", muteState: true }],
        ["SetMicrophoneType", { micType: "dynamic" }],
        ["SetFXPreset", { preset: "Preset7" }],
        ["SetRouteState", { input: "Invalid", output: "Headphones", state: true }],
      ] as const) {
        const values: Record<string, unknown> = inputs;
        const result = yield* Effect.result(
          schemas
            .find((schema) => schema.id === schemaId)!
            .run({
              input: (ref) => values[ref.id],
              output: () => undefined,
              properties: { connection: id },
              event: undefined,
              engine: {
                GoXLRCommand: () => Effect.die("Invalid command must not reach the engine"),
              },
              execution,
              node,
            }),
        );
        assert.isTrue(Result.isFailure(result));
        if (Result.isFailure(result)) assert.instanceOf(result.failure, GoXLRFailure);
      }
    }),
  );
  it.effect("parses/filter patches without truncating the batch at unsupported operations", () =>
    Effect.gen(function* () {
      const response = yield* decodeResponse(
        JSON.stringify({
          id: 0,
          data: {
            Patch: [
              { op: "remove", path: "/ignored" },
              { op: "replace", path: "/mixers/other/levels/volumes/Music", value: 99 },
              { op: "replace", path: "/mixers/serial/levels/volumes/Music", value: 12.7 },
              { op: "replace", path: "/mixers/serial/button_down/Fader1Mute", value: true },
              { op: "replace", path: "/mixers/serial/effects/current/reverb/amount", value: 21.6 },
              {
                op: "replace",
                path: "/mixers/serial/fader_status/A/mute_state",
                value: "MutedToX",
              },
              {
                op: "replace",
                path: "/mixers/serial/fader_status/B",
                value: { mute_state: "Unmuted" },
              },
              { op: "replace", path: "/mixers/serial/fader_status/C", value: false },
              { op: "replace", path: "/mixers/serial/button_down/Bad", value: "true" },
              { op: "replace", path: "/mixers/serial/levels/volumes/Game", value: "12" },
              { op: "test", path: "/mixers/serial/button_down/Test", value: true },
              { op: "add", path: "/mixers/serial/levels/volumes/Line~1In", value: 4 },
            ],
          },
        }),
      );
      assert.isTrue(typeof response.data === "object" && "Patch" in response.data);
      if (typeof response.data !== "object" || !("Patch" in response.data)) return;
      const events = patchEvents(id, "serial", response.data.Patch);
      assert.deepStrictEqual(events, [
        new LevelChange({ connectionId: id, channel: "Music", value: 13 }),
        new ButtonState({ connectionId: id, buttonName: "Fader1Mute", state: true }),
        new DialState({ connectionId: id, dial: "reverb", amount: 22 }),
        new ChannelMuteState({ connectionId: id, channel: "A", state: true }),
        new ChannelMuteState({ connectionId: id, channel: "B", state: false }),
        new ChannelMuteState({ connectionId: id, channel: "C", state: false }),
        new LevelChange({ connectionId: id, channel: "Line/In", value: 4 }),
      ]);
      const schemas = yield* Registration.collect(plugin.effect);
      for (const event of events.slice(0, 4)) {
        const schema = schemas.find((schema) => event._tag === `GoXLR${schema.id}`)!;
        assert.isTrue(yield* schema.matches(event, { connection: id }));
        assert.isFalse(yield* schema.matches(event, { connection: ConnectionId.make("other") }));
        assert.deepStrictEqual(
          schema.properties.map((property) =>
            "resource" in property ? property.resource : undefined,
          ),
          [GoXLRConnection.key],
        );
      }
    }),
  );
  it.effect("rejects malformed JSON, envelopes and status/patch data", () =>
    Effect.gen(function* () {
      for (const text of [
        "invalid",
        "null",
        "{}",
        '{"id":"0","data":"Ok"}',
        '{"id":0,"data":{"Status":{"mixers":{"serial":{}}}}}',
        '{"id":0,"data":{"Patch":[{"op":"replace","path":3,"value":2}]}}',
      ]) {
        assert.isTrue(Result.isFailure(yield* Effect.result(decodeResponse(text))));
      }
      assert.deepStrictEqual(yield* decodeResponse('{"id":0,"data":{"Error":"Invalid device"}}'), {
        id: 0,
        data: { Error: "Invalid device" },
      });
    }),
  );
});
