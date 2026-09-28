import { t } from "@macrograph/module";
import * as Module from "@macrograph/module/Module";
import { Effect } from "effect";

import { KeyLightDevice, KeyLightEngine } from "./Definition.ts";
import { checked, integer, kelvinToMireds, miredsToKelvin } from "./Validation.ts";

const properties = { light: { name: "Key Light", resource: KeyLightDevice } } as const;

const module = Module.make({
  id: "elgato-key-light",
  name: "Elgato Key Light",
  engine: KeyLightEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "GetState",
      name: "Get Key Light State",
      properties,
      io: (io) => ({
        on: io.data.out("on", t.Bool, { name: "On" }),
        brightness: io.data.out("brightness", t.Int, { name: "Brightness (0-100)" }),
        kelvin: io.data.out("kelvin", t.Int, { name: "Temperature (Kelvin)" }),
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
        on: io.data.in("on", t.Bool, { name: "On", defaultValue: true }),
        brightness: io.data.in("brightness", t.Int, {
          name: "Brightness (0-100)",
          defaultValue: 50,
        }),
        kelvin: io.data.in("temperature", t.Int, {
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
      io: (io) => ({ on: io.data.out("on", t.Bool, { name: "On" }) }),
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
          delta: io.data.in("delta", t.Int, {
            name: type === "temperature" ? "Delta (Kelvin)" : "Delta",
            defaultValue: 0,
          }),
          value: io.data.out(type === "temperature" ? "kelvin" : "brightness", t.Int),
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
        io: (io) => ({ value: io.data.in(field, t.Int, { defaultValue }) }),
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
        t.Float,
        (value: number) => integer(value, 0, 100, "Brightness"),
        0,
      ],
      [
        "KelvinToMireds",
        "Kelvin to Mireds",
        "kelvin",
        "mireds",
        t.Int,
        kelvinToMireds,
        4500,
      ],
      ["MiredsToKelvin", "Mireds to Kelvin", "mireds", "kelvin", t.Int, miredsToKelvin, 222],
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
          input: io.data.in(input, t.Int, { defaultValue }),
          output: io.data.out(output, outputType),
        }),
        run: ({ io }) =>
          calculate(io.input).pipe(Effect.flatMap((value) => checked(() => io.output(value)))),
      });
    }
  }),
});

export default module;
