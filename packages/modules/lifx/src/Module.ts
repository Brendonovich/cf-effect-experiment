import { t, Module } from "@macrograph/module";
import { Effect } from "effect";

import { hexToColor } from "./Color.ts";
import { LIFXEngine, LIFXLight } from "./Definition.ts";

const properties = { light: { name: "Light", resource: LIFXLight } } as const;

export default Module.make({
  id: "lifx",
  name: "LIFX",
  engine: LIFXEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "SetLightPower",
      name: "Set Light Power",
      properties,
      io: (io) => ({
        power: io.data.in("power", t.Bool, { name: "On", defaultValue: true }),
        duration: io.data.in("duration", t.Int, { name: "Duration (ms)", defaultValue: 0 }),
      }),
      run: ({ io, properties, engine }) =>
        engine.LIFXSetPower({ deviceId: properties.light, power: io.power, duration: io.duration }),
    });
    yield* context.schema.register({
      id: "SetLightColor",
      name: "Set Light Color",
      properties,
      io: (io) => ({
        hue: io.data.in("hue", t.Float, { name: "Hue (0-360)", defaultValue: 0 }),
        saturation: io.data.in("saturation", t.Float, {
          name: "Saturation (0-100)",
          defaultValue: 0,
        }),
        brightness: io.data.in("brightness", t.Float, {
          name: "Brightness (0-100)",
          defaultValue: 100,
        }),
        kelvin: io.data.in("kelvin", t.Int, {
          name: "Kelvin (1500-9000)",
          defaultValue: 3500,
        }),
        duration: io.data.in("duration", t.Int, { name: "Duration (ms)", defaultValue: 0 }),
      }),
      run: ({ io, properties, engine }) =>
        engine.LIFXSetColor({
          deviceId: properties.light,
          duration: io.duration,
          color: {
            hue: io.hue,
            saturation: io.saturation,
            brightness: io.brightness,
            kelvin: io.kelvin,
          },
        }),
    });
    yield* context.schema.register({
      id: "SetBrightness",
      name: "Set Brightness",
      properties,
      description:
        "Reads the current color before setting brightness, preserving hue, saturation and kelvin.",
      io: (io) => ({
        brightness: io.data.in("brightness", t.Float, {
          name: "Brightness (0-100)",
          defaultValue: 100,
        }),
        duration: io.data.in("duration", t.Int, { name: "Duration (ms)", defaultValue: 0 }),
      }),
      run: ({ io, properties, engine }) =>
        engine.LIFXSetBrightness({
          deviceId: properties.light,
          brightness: io.brightness,
          duration: io.duration,
        }),
    });
    yield* context.schema.register({
      id: "SetKelvin",
      name: "Set Kelvin",
      properties,
      description:
        "Sets white temperature and brightness with zero saturation; preserves the stored hue.",
      io: (io) => ({
        kelvin: io.data.in("kelvin", t.Int, {
          name: "Kelvin (1500-9000)",
          defaultValue: 3500,
        }),
        brightness: io.data.in("brightness", t.Float, {
          name: "Brightness (0-100)",
          defaultValue: 100,
        }),
        duration: io.data.in("duration", t.Int, { name: "Duration (ms)", defaultValue: 0 }),
      }),
      run: ({ io, properties, engine }) =>
        engine.LIFXSetKelvin({
          deviceId: properties.light,
          kelvin: io.kelvin,
          brightness: io.brightness,
          duration: io.duration,
        }),
    });
    yield* context.schema.register({
      id: "GetLightState",
      name: "Get Light State",
      properties,
      io: (io) => ({
        label: io.data.out("label", t.String, { name: "Label" }),
        power: io.data.out("power", t.Bool, { name: "Power" }),
        hue: io.data.out("hue", t.Float, { name: "Hue (0-360)" }),
        saturation: io.data.out("saturation", t.Float, { name: "Saturation (0-100)" }),
        brightness: io.data.out("brightness", t.Float, { name: "Brightness (0-100)" }),
        kelvin: io.data.out("kelvin", t.Int, { name: "Kelvin" }),
        hex: io.data.out("hex", t.String, { name: "Hex Color" }),
      }),
      run: ({ io, properties, engine }) =>
        engine.LIFXGetState({ deviceId: properties.light }).pipe(
          Effect.tap((state) =>
            Effect.sync(() => {
              io.label(state.label);
              io.power(state.power);
              io.hue(state.hue);
              io.saturation(state.saturation);
              io.brightness(state.brightness);
              io.kelvin(state.kelvin);
              io.hex(state.hex);
            }),
          ),
          Effect.asVoid,
        ),
    });
    yield* context.schema.register({
      id: "HexToColor",
      name: "Hex to Color",
      io: (io) => ({
        hex: io.data.in("hex", t.String, { name: "Hex Color", defaultValue: "#ffffff" }),
        hue: io.data.out("hue", t.Int, { name: "Hue (0-360)" }),
        saturation: io.data.out("saturation", t.Int, { name: "Saturation (0-100)" }),
        brightness: io.data.out("brightness", t.Int, { name: "Brightness (0-100)" }),
        lifxHue: io.data.out("lifxHue", t.Int, { name: "LIFX Hue" }),
        lifxSaturation: io.data.out("lifxSaturation", t.Int, { name: "LIFX Saturation" }),
        lifxBrightness: io.data.out("lifxBrightness", t.Int, { name: "LIFX Brightness" }),
      }),
      run: ({ io }) =>
        hexToColor(io.hex).pipe(
          Effect.tap((color) =>
            Effect.sync(() => {
              io.hue(color.hue);
              io.saturation(color.saturation);
              io.brightness(color.brightness);
              io.lifxHue(color.lifxHue);
              io.lifxSaturation(color.lifxSaturation);
              io.lifxBrightness(color.lifxBrightness);
            }),
          ),
          Effect.asVoid,
        ),
    });
  }),
});
