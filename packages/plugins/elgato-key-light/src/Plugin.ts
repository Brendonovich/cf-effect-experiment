import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect } from "effect";

import { KeyLightDevice, KeyLightEngine } from "./Definition.ts";
import { checked, integer, kelvinToMireds, miredsToKelvin } from "./Validation.ts";

const properties = { light: { name: "Key Light", resource: KeyLightDevice } } as const;

const plugin = Plugin.make({
  id: "elgato-key-light",
  name: "Elgato Key Light",
  engine: KeyLightEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "GetState",
      name: "Get Key Light State",
      properties,
      io: (io) => ({
        on: io.data.out("on", DataType.Bool, { name: "On" }),
        brightness: io.data.out("brightness", DataType.Int, { name: "Brightness (0-100)" }),
        kelvin: io.data.out("kelvin", DataType.Int, { name: "Temperature (Kelvin)" }),
      }),
      run: ({ io, properties, engine }) =>
        Effect.gen(function* () {
          const state = yield* engine.ElgatoKeyLightGetState({ deviceId: properties.light });
          io.on(state.on);
          io.brightness(state.brightness);
          io.kelvin(state.kelvin);
        }),
    });
    yield* context.schema.register({
      id: "SetState",
      name: "Set Key Light State",
      properties,
      description: "Sets power, brightness and temperature on all channels of the selected device.",
      io: (io) => ({
        on: io.data.in("on", DataType.Bool, { name: "On", defaultValue: true }),
        brightness: io.data.in("brightness", DataType.Int, {
          name: "Brightness (0-100)",
          defaultValue: 50,
        }),
        kelvin: io.data.in("temperature", DataType.Int, {
          name: "Temperature (Kelvin)",
          defaultValue: 4500,
        }),
      }),
      run: ({ io, properties, engine }) =>
        engine
          .ElgatoKeyLightUpdateState({
            deviceId: properties.light,
            operation: {
              type: "set",
              state: { on: io.on, brightness: io.brightness, kelvin: io.kelvin },
            },
          })
          .pipe(Effect.asVoid),
    });
    yield* context.schema.register({
      id: "Toggle",
      name: "Toggle Key Light",
      properties,
      io: (io) => ({ on: io.data.out("on", DataType.Bool, { name: "On" }) }),
      run: ({ io, properties, engine }) =>
        Effect.gen(function* () {
          const state = yield* engine.ElgatoKeyLightUpdateState({
            deviceId: properties.light,
            operation: { type: "toggle" },
          });
          io.on(state.on);
        }),
    });
    for (const [id, name, type] of [
      ["IncrementBrightness", "Increment Brightness", "brightness"],
      ["IncrementTemperature", "Increment Temperature", "temperature"],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        properties,
        description:
          type === "brightness"
            ? "Clamps the result to 0-100."
            : "Adds a Kelvin delta and clamps the result to 2900-7000 K.",
        io: (io) => ({
          delta: io.data.in("delta", DataType.Int, {
            name: type === "temperature" ? "Delta (Kelvin)" : "Delta",
            defaultValue: 0,
          }),
          value: io.data.out(type === "temperature" ? "kelvin" : "brightness", DataType.Int),
        }),
        run: ({ io, properties, engine }) =>
          Effect.gen(function* () {
            const state = yield* engine.ElgatoKeyLightUpdateState({
              deviceId: properties.light,
              operation: { type, delta: io.delta },
            });
            io.value(type === "temperature" ? state.kelvin : state.brightness);
          }),
      });
    }
    for (const [id, name, field, defaultValue] of [
      ["SetBrightness", "Set Key Light Brightness", "brightness", 50],
      ["SetTemperature", "Set Key Light Temperature", "kelvin", 4500],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        properties,
        description: "Changes only this field, preserving power and the other field.",
        io: (io) => ({ value: io.data.in(field, DataType.Int, { defaultValue }) }),
        run: ({ io, properties, engine }) =>
          engine
            .ElgatoKeyLightUpdateState({
              deviceId: properties.light,
              operation: { type: "set", state: { [field]: io.value } },
            })
            .pipe(Effect.asVoid),
      });
    }
    for (const [id, name, input, output, outputType, calculate, defaultValue] of [
      [
        "BrightnessToPercent",
        "Brightness to Percent",
        "brightness",
        "percent",
        DataType.Float,
        (value: number) => integer(value, 0, 100, "Brightness"),
        0,
      ],
      [
        "KelvinToMireds",
        "Kelvin to Mireds",
        "kelvin",
        "mireds",
        DataType.Int,
        kelvinToMireds,
        4500,
      ],
      ["MiredsToKelvin", "Mireds to Kelvin", "mireds", "kelvin", DataType.Int, miredsToKelvin, 222],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        type: "pure",
        description:
          id === "BrightnessToPercent"
            ? "Brightness is already a 0-100 percent value."
            : "Converts Key Light temperatures with rounding to the nearest integer.",
        io: (io) => ({
          input: io.data.in(input, DataType.Int, { defaultValue }),
          output: io.data.out(output, outputType),
        }),
        run: ({ io }) =>
          calculate(io.input).pipe(Effect.flatMap((value) => checked(() => io.output(value)))),
      });
    }
  }),
});

export default plugin;
