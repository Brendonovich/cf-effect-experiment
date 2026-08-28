import { DataType, Plugin } from "@macrograph/plugin";
import { Effect } from "effect";

import { hexToColor } from "./Color.ts";
import { LIFXEngine, LIFXLight } from "./Definition.ts";

const properties = { light: { name: "Light", resource: LIFXLight } } as const;

export default Plugin.make({
  id: "lifx",
  name: "LIFX",
  engine: LIFXEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "SetLightPower",
      name: "Set Light Power",
      properties,
      io: (io) => ({
        power: io.data.in("power", DataType.Bool, { name: "On", defaultValue: true }),
        duration: io.data.in("duration", DataType.Int, { name: "Duration (ms)", defaultValue: 0 }),
      }),
      run: ({ io, properties, engine }) =>
        engine.LIFXSetPower({ deviceId: properties.light, power: io.power, duration: io.duration }),
    });
    yield* context.schema.register({
      id: "SetLightColor",
      name: "Set Light Color",
      properties,
      io: (io) => ({
        hue: io.data.in("hue", DataType.Float, { name: "Hue (0-360)", defaultValue: 0 }),
        saturation: io.data.in("saturation", DataType.Float, {
          name: "Saturation (0-100)",
          defaultValue: 0,
        }),
        brightness: io.data.in("brightness", DataType.Float, {
          name: "Brightness (0-100)",
          defaultValue: 100,
        }),
        kelvin: io.data.in("kelvin", DataType.Int, {
          name: "Kelvin (1500-9000)",
          defaultValue: 3500,
        }),
        duration: io.data.in("duration", DataType.Int, { name: "Duration (ms)", defaultValue: 0 }),
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
        brightness: io.data.in("brightness", DataType.Float, {
          name: "Brightness (0-100)",
          defaultValue: 100,
        }),
        duration: io.data.in("duration", DataType.Int, { name: "Duration (ms)", defaultValue: 0 }),
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
        kelvin: io.data.in("kelvin", DataType.Int, {
          name: "Kelvin (1500-9000)",
          defaultValue: 3500,
        }),
        brightness: io.data.in("brightness", DataType.Float, {
          name: "Brightness (0-100)",
          defaultValue: 100,
        }),
        duration: io.data.in("duration", DataType.Int, { name: "Duration (ms)", defaultValue: 0 }),
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
        label: io.data.out("label", DataType.String, { name: "Label" }),
        power: io.data.out("power", DataType.Bool, { name: "Power" }),
        hue: io.data.out("hue", DataType.Float, { name: "Hue (0-360)" }),
        saturation: io.data.out("saturation", DataType.Float, { name: "Saturation (0-100)" }),
        brightness: io.data.out("brightness", DataType.Float, { name: "Brightness (0-100)" }),
        kelvin: io.data.out("kelvin", DataType.Int, { name: "Kelvin" }),
        hex: io.data.out("hex", DataType.String, { name: "Hex Color" }),
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
        hex: io.data.in("hex", DataType.String, { name: "Hex Color", defaultValue: "#ffffff" }),
        hue: io.data.out("hue", DataType.Int, { name: "Hue (0-360)" }),
        saturation: io.data.out("saturation", DataType.Int, { name: "Saturation (0-100)" }),
        brightness: io.data.out("brightness", DataType.Int, { name: "Brightness (0-100)" }),
        lifxHue: io.data.out("lifxHue", DataType.Int, { name: "LIFX Hue" }),
        lifxSaturation: io.data.out("lifxSaturation", DataType.Int, { name: "LIFX Saturation" }),
        lifxBrightness: io.data.out("lifxBrightness", DataType.Int, { name: "LIFX Brightness" }),
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
