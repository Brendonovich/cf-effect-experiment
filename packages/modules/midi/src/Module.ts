import { t } from "@macrograph/module";
import * as Module from "@macrograph/module/Module";
import { Effect } from "effect";

import { MidiEngine, MidiInput, MidiOutput } from "./Definition.ts";
import { encode, type Message, type MessageOf, parse, validateRaw } from "./Protocol.ts";

const inputProperties = { input: { name: "MIDI Input", resource: MidiInput } } as const;
const outputProperties = { output: { name: "MIDI Output", resource: MidiOutput } } as const;

const channelOut = { name: "Channel (1-16)" };
const channelIn = { name: "Channel (1-16)", defaultValue: 1 };

const MidiModule = Module.make({
  name: "MIDI",
  engine: MidiEngine,
  effect: Effect.fnUntraced(function* (context) {
    const received = <Type extends Message["type"]>(type: Type) => ({
      type: "event" as const,
      properties: inputProperties,
      event: (
        event: { readonly inputId: string; readonly data: ReadonlyArray<number> },
        { properties }: { readonly properties: { readonly input: string } },
      ) => Effect.succeed(event.inputId === properties.input && parse(event.data)?.type === type),
      message: (event: { readonly data: ReadonlyArray<number> } | undefined) => {
        const message = event && parse(event.data);
        return message?.type === type ? (message as MessageOf<Type>) : undefined;
      },
    });

    const noteOn = received("noteOn");
    yield* context.schema.register({
      id: "NoteOn",
      name: "MIDI Note On",
      description: "A Note On with velocity 0 is reported as Note Off.",
      ...noteOn,
      io: (io) => ({
        channel: io.data.out("channel", t.Int, channelOut),
        note: io.data.out("note", t.Int, { name: "Note" }),
        velocity: io.data.out("velocity", t.Int, { name: "Velocity" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          const message = noteOn.message(event);
          if (!message) return;
          io.channel(message.channel);
          io.note(message.note);
          io.velocity(message.velocity);
        }),
    });

    const noteOff = received("noteOff");
    yield* context.schema.register({
      id: "NoteOff",
      name: "MIDI Note Off",
      description: "Also fires for Note On messages with velocity 0.",
      ...noteOff,
      io: (io) => ({
        channel: io.data.out("channel", t.Int, channelOut),
        note: io.data.out("note", t.Int, { name: "Note" }),
        velocity: io.data.out("velocity", t.Int, { name: "Velocity" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          const message = noteOff.message(event);
          if (!message) return;
          io.channel(message.channel);
          io.note(message.note);
          io.velocity(message.velocity);
        }),
    });

    const controlChange = received("controlChange");
    yield* context.schema.register({
      id: "ControlChange",
      name: "MIDI Control Change",
      ...controlChange,
      io: (io) => ({
        channel: io.data.out("channel", t.Int, channelOut),
        control: io.data.out("control", t.Int, { name: "Control" }),
        value: io.data.out("value", t.Int, { name: "Value" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          const message = controlChange.message(event);
          if (!message) return;
          io.channel(message.channel);
          io.control(message.control);
          io.value(message.value);
        }),
    });

    const programChange = received("programChange");
    yield* context.schema.register({
      id: "ProgramChange",
      name: "MIDI Program Change",
      ...programChange,
      io: (io) => ({
        channel: io.data.out("channel", t.Int, channelOut),
        program: io.data.out("program", t.Int, { name: "Program" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          const message = programChange.message(event);
          if (!message) return;
          io.channel(message.channel);
          io.program(message.program);
        }),
    });

    const channelAftertouch = received("channelAftertouch");
    yield* context.schema.register({
      id: "ChannelAftertouch",
      name: "MIDI Channel Aftertouch",
      ...channelAftertouch,
      io: (io) => ({
        channel: io.data.out("channel", t.Int, channelOut),
        pressure: io.data.out("pressure", t.Int, { name: "Pressure" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          const message = channelAftertouch.message(event);
          if (!message) return;
          io.channel(message.channel);
          io.pressure(message.pressure);
        }),
    });

    const polyphonicAftertouch = received("polyphonicAftertouch");
    yield* context.schema.register({
      id: "PolyphonicAftertouch",
      name: "MIDI Polyphonic Aftertouch",
      ...polyphonicAftertouch,
      io: (io) => ({
        channel: io.data.out("channel", t.Int, channelOut),
        note: io.data.out("note", t.Int, { name: "Note" }),
        pressure: io.data.out("pressure", t.Int, { name: "Pressure" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          const message = polyphonicAftertouch.message(event);
          if (!message) return;
          io.channel(message.channel);
          io.note(message.note);
          io.pressure(message.pressure);
        }),
    });

    const pitchBend = received("pitchBend");
    yield* context.schema.register({
      id: "PitchBend",
      name: "MIDI Pitch Bend",
      ...pitchBend,
      io: (io) => ({
        channel: io.data.out("channel", t.Int, channelOut),
        value: io.data.out("value", t.Int, { name: "Bend (-8192 to 8191)" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          const message = pitchBend.message(event);
          if (!message) return;
          io.channel(message.channel);
          io.value(message.value);
        }),
    });

    const sysex = received("sysex");
    yield* context.schema.register({
      id: "SysEx",
      name: "MIDI SysEx Received",
      description: "Outputs the bytes between the F0 and F7 framing bytes.",
      ...sysex,
      io: (io) => ({ data: io.data.out("data", t.List(t.Int), { name: "Data" }) }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          const message = sysex.message(event);
          if (message) io.data([...message.data]);
        }),
    });

    yield* context.schema.register({
      id: "MessageReceived",
      name: "MIDI Message Received",
      description: "Fires for every message from the input, including ones without a typed node.",
      type: "event",
      properties: inputProperties,
      event: (event, { properties }) => Effect.succeed(event.inputId === properties.input),
      io: (io) => ({ data: io.data.out("data", t.List(t.Int), { name: "Bytes" }) }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event) io.data([...event.data]);
        }),
    });

    yield* context.schema.register({
      id: "SendNoteOn",
      name: "Send MIDI Note On",
      properties: outputProperties,
      io: (io) => ({
        channel: io.data.in("channel", t.Int, channelIn),
        note: io.data.in("note", t.Int, { name: "Note", defaultValue: 60 }),
        velocity: io.data.in("velocity", t.Int, { name: "Velocity", defaultValue: 127 }),
      }),
      run: ({ io, properties, engine }) =>
        encode({ type: "noteOn", channel: io.channel, note: io.note, velocity: io.velocity }).pipe(
          Effect.flatMap((data) => engine.MidiSend({ outputId: properties.output, data })),
        ),
    });

    yield* context.schema.register({
      id: "SendNoteOff",
      name: "Send MIDI Note Off",
      properties: outputProperties,
      io: (io) => ({
        channel: io.data.in("channel", t.Int, channelIn),
        note: io.data.in("note", t.Int, { name: "Note", defaultValue: 60 }),
        velocity: io.data.in("velocity", t.Int, { name: "Velocity", defaultValue: 0 }),
      }),
      run: ({ io, properties, engine }) =>
        encode({ type: "noteOff", channel: io.channel, note: io.note, velocity: io.velocity }).pipe(
          Effect.flatMap((data) => engine.MidiSend({ outputId: properties.output, data })),
        ),
    });

    yield* context.schema.register({
      id: "SendControlChange",
      name: "Send MIDI Control Change",
      properties: outputProperties,
      io: (io) => ({
        channel: io.data.in("channel", t.Int, channelIn),
        control: io.data.in("control", t.Int, { name: "Control", defaultValue: 0 }),
        value: io.data.in("value", t.Int, { name: "Value", defaultValue: 0 }),
      }),
      run: ({ io, properties, engine }) =>
        encode({
          type: "controlChange",
          channel: io.channel,
          control: io.control,
          value: io.value,
        }).pipe(Effect.flatMap((data) => engine.MidiSend({ outputId: properties.output, data }))),
    });

    yield* context.schema.register({
      id: "SendProgramChange",
      name: "Send MIDI Program Change",
      properties: outputProperties,
      io: (io) => ({
        channel: io.data.in("channel", t.Int, channelIn),
        program: io.data.in("program", t.Int, { name: "Program", defaultValue: 0 }),
      }),
      run: ({ io, properties, engine }) =>
        encode({ type: "programChange", channel: io.channel, program: io.program }).pipe(
          Effect.flatMap((data) => engine.MidiSend({ outputId: properties.output, data })),
        ),
    });

    yield* context.schema.register({
      id: "SendChannelAftertouch",
      name: "Send MIDI Channel Aftertouch",
      properties: outputProperties,
      io: (io) => ({
        channel: io.data.in("channel", t.Int, channelIn),
        pressure: io.data.in("pressure", t.Int, { name: "Pressure", defaultValue: 0 }),
      }),
      run: ({ io, properties, engine }) =>
        encode({ type: "channelAftertouch", channel: io.channel, pressure: io.pressure }).pipe(
          Effect.flatMap((data) => engine.MidiSend({ outputId: properties.output, data })),
        ),
    });

    yield* context.schema.register({
      id: "SendPolyphonicAftertouch",
      name: "Send MIDI Polyphonic Aftertouch",
      properties: outputProperties,
      io: (io) => ({
        channel: io.data.in("channel", t.Int, channelIn),
        note: io.data.in("note", t.Int, { name: "Note", defaultValue: 60 }),
        pressure: io.data.in("pressure", t.Int, { name: "Pressure", defaultValue: 0 }),
      }),
      run: ({ io, properties, engine }) =>
        encode({
          type: "polyphonicAftertouch",
          channel: io.channel,
          note: io.note,
          pressure: io.pressure,
        }).pipe(Effect.flatMap((data) => engine.MidiSend({ outputId: properties.output, data }))),
    });

    yield* context.schema.register({
      id: "SendPitchBend",
      name: "Send MIDI Pitch Bend",
      properties: outputProperties,
      io: (io) => ({
        channel: io.data.in("channel", t.Int, channelIn),
        value: io.data.in("value", t.Int, {
          name: "Bend (-8192 to 8191)",
          defaultValue: 0,
        }),
      }),
      run: ({ io, properties, engine }) =>
        encode({ type: "pitchBend", channel: io.channel, value: io.value }).pipe(
          Effect.flatMap((data) => engine.MidiSend({ outputId: properties.output, data })),
        ),
    });

    yield* context.schema.register({
      id: "SendSysEx",
      name: "Send MIDI SysEx",
      description:
        "Sends the bytes wrapped in F0 ... F7. Use this for device commands such as Launchpad RGB lighting.",
      properties: outputProperties,
      io: (io) => ({
        data: io.data.in("data", t.List(t.Int), { name: "Data", defaultValue: [] }),
      }),
      run: ({ io, properties, engine }) =>
        encode({ type: "sysex", data: io.data }).pipe(
          Effect.flatMap((data) => engine.MidiSend({ outputId: properties.output, data })),
        ),
    });

    yield* context.schema.register({
      id: "SendRaw",
      name: "Send MIDI Message",
      description: "Sends raw bytes as-is. The first byte must be a status byte (128-255).",
      properties: outputProperties,
      io: (io) => ({
        data: io.data.in("data", t.List(t.Int), { name: "Bytes", defaultValue: [] }),
      }),
      run: ({ io, properties, engine }) =>
        validateRaw(io.data).pipe(
          Effect.flatMap((data) => engine.MidiSend({ outputId: properties.output, data })),
        ),
    });
  }),
});

export default MidiModule;
