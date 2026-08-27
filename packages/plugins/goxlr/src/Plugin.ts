import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect, Schema } from "effect";

import {
  ButtonState,
  ChannelMuteState,
  Command,
  DialState,
  GoXLRConnection,
  GoXLREngine,
  GoXLRFailure,
  LevelChange,
} from "./Definition.ts";

const properties = { connection: { name: "Connection", resource: GoXLRConnection } } as const;
const decodeCommand = (value: unknown) =>
  Schema.decodeUnknownEffect(Command)(value).pipe(
    Effect.mapError(
      () =>
        new GoXLRFailure({ reason: "Invalid GoXLR command input. Enum names are case-sensitive." }),
    ),
  );

const GoXLRPlugin = Plugin.make({
  id: "goxlr",
  name: "GoXLR",
  engine: GoXLREngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "MuteSlider",
      name: "Mute Slider",
      properties,
      description: "Slider: A, B, C or D. Waits for the daemon to acknowledge the command.",
      io: (io) => ({
        slider: io.data.in("Slider", DataType.String, { name: "Slider" }),
        muteState: io.data.in("muteState", DataType.Bool, { name: "Mute State" }),
      }),
      run: ({ io, properties, engine }) =>
        decodeCommand({
          SetFaderMuteState: [io.slider, io.muteState ? "MutedToX" : "Unmuted"],
        }).pipe(
          Effect.flatMap((command) =>
            engine.GoXLRCommand({ connectionId: properties.connection, command }),
          ),
        ),
    });
    yield* context.schema.register({
      id: "SetMicrophoneType",
      name: "Set Microphone Type",
      properties,
      description: "Mic Type: Dynamic, Condenser or Jack.",
      io: (io) => ({ micType: io.data.in("micType", DataType.String, { name: "Mic Type" }) }),
      run: ({ io, properties, engine }) =>
        decodeCommand({ SetMicrophoneType: io.micType }).pipe(
          Effect.flatMap((command) =>
            engine.GoXLRCommand({ connectionId: properties.connection, command }),
          ),
        ),
    });
    for (const [id, name] of [
      ["SetReverbAmount", "Set Reverb Amount"],
      ["SetEchoAmount", "Set Echo Amount"],
      ["SetPitchAmount", "Set Pitch Amount"],
      ["SetGenderAmount", "Set Gender Amount"],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        properties,
        io: (io) => ({ amount: io.data.in("amount", DataType.Int, { name: "Amount" }) }),
        run: ({ io, properties, engine }) =>
          decodeCommand({ [id]: io.amount }).pipe(
            Effect.flatMap((command) =>
              engine.GoXLRCommand({ connectionId: properties.connection, command }),
            ),
          ),
      });
    }
    yield* context.schema.register({
      id: "SetFXState",
      name: "Set FX State",
      properties,
      io: (io) => ({ state: io.data.in("state", DataType.Bool, { name: "State" }) }),
      run: ({ io, properties, engine }) =>
        engine.GoXLRCommand({
          connectionId: properties.connection,
          command: { SetFXEnabled: io.state },
        }),
    });
    yield* context.schema.register({
      id: "SetFXPreset",
      name: "Set FX Preset",
      properties,
      description: "Preset: Preset1 through Preset6.",
      io: (io) => ({ preset: io.data.in("preset", DataType.String, { name: "Preset" }) }),
      run: ({ io, properties, engine }) =>
        decodeCommand({ SetActiveEffectPreset: io.preset }).pipe(
          Effect.flatMap((command) =>
            engine.GoXLRCommand({ connectionId: properties.connection, command }),
          ),
        ),
    });
    yield* context.schema.register({
      id: "SetRouteState",
      name: "Set Route State",
      properties,
      description:
        "Input: Microphone, Chat, Music, Game, Console, LineIn, System, Samples. Output: Headphones, BroadcastMix, LineOut, ChatMic, Sampler.",
      io: (io) => ({
        input: io.data.in("input", DataType.String, { name: "Input" }),
        output: io.data.in("output", DataType.String, { name: "Output" }),
        state: io.data.in("state", DataType.Bool, { name: "State" }),
      }),
      run: ({ io, properties, engine }) =>
        decodeCommand({ SetRouter: [io.input, io.output, io.state] }).pipe(
          Effect.flatMap((command) =>
            engine.GoXLRCommand({ connectionId: properties.connection, command }),
          ),
        ),
    });
    yield* context.schema.register({
      id: "LevelChange",
      name: "Level Change",
      type: "event",
      properties,
      event: (event, { properties }) =>
        Effect.succeed(
          event instanceof LevelChange && event.connectionId === properties.connection,
        ),
      io: (io) => ({
        channel: io.data.out("channel", DataType.String, { name: "Channel" }),
        value: io.data.out("value", DataType.Int, { name: "Value" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event instanceof LevelChange) {
            io.channel(event.channel);
            io.value(event.value);
          }
        }),
    });
    yield* context.schema.register({
      id: "ButtonState",
      name: "Button State",
      type: "event",
      properties,
      event: (event, { properties }) =>
        Effect.succeed(
          event instanceof ButtonState && event.connectionId === properties.connection,
        ),
      io: (io) => ({
        buttonName: io.data.out("buttonName", DataType.String, { name: "Button Name" }),
        state: io.data.out("state", DataType.Bool, { name: "State" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event instanceof ButtonState) {
            io.buttonName(event.buttonName);
            io.state(event.state);
          }
        }),
    });
    yield* context.schema.register({
      id: "DialState",
      name: "Dial State",
      type: "event",
      properties,
      event: (event, { properties }) =>
        Effect.succeed(event instanceof DialState && event.connectionId === properties.connection),
      io: (io) => ({
        dial: io.data.out("dial", DataType.String, { name: "Dial" }),
        amount: io.data.out("amount", DataType.Int, { name: "Amount" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event instanceof DialState) {
            io.dial(event.dial);
            io.amount(event.amount);
          }
        }),
    });
    yield* context.schema.register({
      id: "ChannelMuteState",
      name: "Channel Mute State",
      type: "event",
      properties,
      event: (event, { properties }) =>
        Effect.succeed(
          event instanceof ChannelMuteState && event.connectionId === properties.connection,
        ),
      io: (io) => ({
        channel: io.data.out("channel", DataType.String, { name: "Channel" }),
        state: io.data.out("state", DataType.Bool, { name: "State" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event instanceof ChannelMuteState) {
            io.channel(event.channel);
            io.state(event.state);
          }
        }),
    });
  }),
});

export default GoXLRPlugin;
