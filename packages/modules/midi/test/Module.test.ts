import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/module";
import { Effect } from "effect";

import { InputId, MidiInput, MidiMessage, MidiOutput, OutputId } from "../src/Definition.ts";
import deployment from "../src/Deployment.ts";
import module from "../src/Module.ts";

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
const input = InputId.make("Launchpad");
const output = OutputId.make("Launchpad");

const events = [
  "NoteOn",
  "NoteOff",
  "ControlChange",
  "ProgramChange",
  "ChannelAftertouch",
  "PolyphonicAftertouch",
  "PitchBend",
  "SysEx",
  "MessageReceived",
];
const sends = [
  "SendNoteOn",
  "SendNoteOff",
  "SendControlChange",
  "SendProgramChange",
  "SendChannelAftertouch",
  "SendPolyphonicAftertouch",
  "SendPitchBend",
  "SendSysEx",
  "SendRaw",
];

describe("MIDI catalog", () => {
  it.effect("registers receive and send nodes against input and output resources", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(module.effect);
      assert.deepStrictEqual(
        schemas.map((schema) => schema.id),
        [...events, ...sends],
      );
      assert.isDefined(deployment);
      for (const schema of schemas) {
        const isEvent = events.includes(schema.id);
        assert.strictEqual(schema.type, isEvent ? "event" : "exec", schema.id);
        assert.deepStrictEqual(
          schema.properties.map((property) =>
            "resource" in property ? property.resource : undefined,
          ),
          [isEvent ? MidiInput.key : MidiOutput.key],
        );
      }
    }),
  );

  it.effect("routes messages to the matching typed event and forwards outputs", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(module.effect);
      const get = (id: string) => schemas.find((schema) => schema.id === id)!;
      const message = new MidiMessage({ inputId: input, data: [0x92, 81, 100] });
      const matches = (id: string, event: MidiMessage, properties = { input }) =>
        get(id).matches(event, properties);

      assert.isTrue(yield* matches("NoteOn", message));
      assert.isTrue(yield* matches("MessageReceived", message));
      assert.isFalse(yield* matches("NoteOff", message));
      assert.isFalse(yield* matches("NoteOn", message, { input: InputId.make("Other") }));
      assert.isTrue(
        yield* matches("NoteOff", new MidiMessage({ inputId: input, data: [0x92, 81, 0] })),
      );

      const outputs: Record<string, unknown> = {};
      yield* get("NoteOn").run({
        input: () => undefined,
        output: (ref, value) => {
          outputs[ref.id] = value;
        },
        properties: { input },
        event: message,
        execution,
        node,
        engine: {},
      });
      assert.deepStrictEqual(outputs, { channel: 3, note: 81, velocity: 100 });
    }),
  );

  it.effect("encodes send nodes into a single runtime send", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(module.effect);
      const cases: Array<[string, Record<string, unknown>, number[]]> = [
        ["SendNoteOn", { channel: 1, note: 11, velocity: 5 }, [0x90, 11, 5]],
        ["SendNoteOff", { channel: 2, note: 11, velocity: 0 }, [0x81, 11, 0]],
        ["SendControlChange", { channel: 1, control: 91, value: 21 }, [0xb0, 91, 21]],
        ["SendProgramChange", { channel: 1, program: 3 }, [0xc0, 3]],
        ["SendChannelAftertouch", { channel: 1, pressure: 9 }, [0xd0, 9]],
        ["SendPolyphonicAftertouch", { channel: 1, note: 11, pressure: 9 }, [0xa0, 11, 9]],
        ["SendPitchBend", { channel: 1, value: 0 }, [0xe0, 0, 64]],
        [
          "SendSysEx",
          { data: [0x00, 0x20, 0x29, 0x02, 0x0d, 0x03, 0x03, 11, 127, 0, 0] },
          [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x03, 0x03, 11, 127, 0, 0, 0xf7],
        ],
        ["SendRaw", { data: [0xb0, 0, 0] }, [0xb0, 0, 0]],
      ];
      for (const [id, inputs, data] of cases) {
        const calls: unknown[] = [];
        yield* schemas
          .find((schema) => schema.id === id)!
          .run({
            input: (ref) => inputs[ref.id],
            output: () => {},
            properties: { output },
            event: undefined,
            execution,
            node,
            engine: {
              MidiSend: (payload: unknown) =>
                Effect.sync(() => {
                  calls.push(payload);
                }),
            },
          });
        assert.deepStrictEqual(calls, [{ outputId: output, data }], id);
      }

      const calls: unknown[] = [];
      const failure = yield* Effect.flip(
        schemas
          .find((schema) => schema.id === "SendNoteOn")!
          .run({
            input: (ref) => ({ channel: 17, note: 1, velocity: 1 })[ref.id],
            output: () => {},
            properties: { output },
            event: undefined,
            execution,
            node,
            engine: { MidiSend: (payload: unknown) => Effect.sync(() => calls.push(payload)) },
          }),
      );
      assert.include(String((failure as { reason?: unknown }).reason), "Channel");
      assert.deepStrictEqual(calls, []);
    }),
  );
});
