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
    yield* context.schema.register({
      id: "IncrementBrightness",
      name: "Increment Brightness",
      properties,
      description: "Clamps the result to 0-100.",
      io: (io) => ({
        delta: io.data.in("delta", t.Int, { name: "Delta", defaultValue: 0 }),
        value: io.data.out("brightness", t.Int),
      }),
      run: ({ io, properties, engine }) =>
        Effect.gen(function* () {
          const state = yield* engine.ElgatoKeyLightUpdateState({
            deviceId: properties.light,
            operation: { type: "brightness", delta: io.delta },
          });
          io.value(state.brightness);
        }),
    });
    yield* context.schema.register({
      id: "IncrementTemperature",
      name: "Increment Temperature",
      properties,
      description: "Adds a Kelvin delta and clamps the result to 2900-7000 K.",
      io: (io) => ({
        delta: io.data.in("delta", t.Int, { name: "Delta (Kelvin)", defaultValue: 0 }),
        value: io.data.out("kelvin", t.Int),
      }),
      run: ({ io, properties, engine }) =>
        Effect.gen(function* () {
          const state = yield* engine.ElgatoKeyLightUpdateState({
            deviceId: properties.light,
            operation: { type: "temperature", delta: io.delta },
          });
          io.value(state.kelvin);
        }),
    });
    yield* context.schema.register({
      id: "SetBrightness",
      name: "Set Key Light Brightness",
      properties,
      description: "Changes only this field, preserving power and the other field.",
      io: (io) => ({ value: io.data.in("brightness", t.Int, { defaultValue: 50 }) }),
      run: ({ io, properties, engine }) =>
        engine
          .ElgatoKeyLightUpdateState({
            deviceId: properties.light,
            operation: { type: "set", state: { brightness: io.value } },
          })
          .pipe(Effect.asVoid),
    });
    yield* context.schema.register({
      id: "SetTemperature",
      name: "Set Key Light Temperature",
      properties,
      description: "Changes only this field, preserving power and the other field.",
      io: (io) => ({ value: io.data.in("kelvin", t.Int, { defaultValue: 4500 }) }),
      run: ({ io, properties, engine }) =>
        engine
          .ElgatoKeyLightUpdateState({
            deviceId: properties.light,
            operation: { type: "set", state: { kelvin: io.value } },
          })
          .pipe(Effect.asVoid),
    });
    yield* context.schema.register({
      id: "BrightnessToPercent",
      name: "Brightness to Percent",
      type: "pure",
      description: "Brightness is already a 0-100 percent value.",
      io: (io) => ({
        input: io.data.in("brightness", t.Int, { defaultValue: 0 }),
        output: io.data.out("percent", t.Float),
      }),
      run: ({ io }) =>
        integer(io.input, 0, 100, "Brightness").pipe(
          Effect.flatMap((value) => checked(() => io.output(value))),
        ),
    });
    yield* context.schema.register({
      id: "KelvinToMireds",
      name: "Kelvin to Mireds",
      type: "pure",
      description: "Converts Key Light temperatures with rounding to the nearest integer.",
      io: (io) => ({
        input: io.data.in("kelvin", t.Int, { defaultValue: 4500 }),
        output: io.data.out("mireds", t.Int),
      }),
      run: ({ io }) =>
        kelvinToMireds(io.input).pipe(Effect.flatMap((value) => checked(() => io.output(value)))),
    });
    yield* context.schema.register({
      id: "MiredsToKelvin",
      name: "Mireds to Kelvin",
      type: "pure",
      description: "Converts Key Light temperatures with rounding to the nearest integer.",
      io: (io) => ({
        input: io.data.in("mireds", t.Int, { defaultValue: 222 }),
        output: io.data.out("kelvin", t.Int),
      }),
      run: ({ io }) =>
        miredsToKelvin(io.input).pipe(Effect.flatMap((value) => checked(() => io.output(value)))),
    });
  }),
});

export default module;
