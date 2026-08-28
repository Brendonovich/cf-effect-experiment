import { DataType } from "@macrograph/plugin/DataType";
import * as Plugin from "@macrograph/plugin/Plugin";
import { Effect, Option } from "effect";

import { IkeaEngine, IkeaLight } from "./Definition.ts";

const properties = { light: { name: "Light", resource: IkeaLight } } as const;
const plugin = Plugin.make({
  id: "ikea-tradfri",
  name: "IKEA TRADFRI Gateway",
  engine: IkeaEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "SetLightState",
      name: "Set Light State",
      properties,
      io: (io) => ({
        state: io.data.in("state", DataType.Bool, { name: "On", defaultValue: true }),
      }),
      run: ({ io, properties, engine }) =>
        engine.IkeaSetLightState({
          lightId: properties.light,
          state: { on: io.state },
        }),
    });
    for (const [id, name, field, label, defaultValue] of [
      ["SetBrightness", "Set Brightness", "brightness", "Brightness (0-254)", 127],
      [
        "SetColorTemperature",
        "Set Color Temperature",
        "colorTemp",
        "Temperature (2200-4000 K)",
        2700,
      ],
    ] as const) {
      yield* context.schema.register({
        id,
        name,
        properties,
        io: (io) => ({ value: io.data.in(field, DataType.Int, { name: label, defaultValue }) }),
        run: ({ io, properties, engine }) =>
          engine.IkeaSetLightState({
            lightId: properties.light,
            state: { [field]: io.value },
          }),
      });
    }
    yield* context.schema.register({
      id: "SetColor",
      name: "Set Color",
      properties,
      io: (io) => ({
        color: io.data.in("hexColor", DataType.String, {
          name: "Hex Color",
          defaultValue: "ffffff",
        }),
      }),
      run: ({ io, properties, engine }) =>
        engine.IkeaSetLightState({
          lightId: properties.light,
          state: { hexColor: io.color },
        }),
    });
    yield* context.schema.register({
      id: "ListLights",
      name: "List Lights",
      description:
        "Queries the gateway for fresh light states. Returns a JSON array, not cached states.",
      io: (io) => ({ lights: io.data.out("lights", DataType.String, { name: "Lights JSON" }) }),
      run: ({ io, engine }) =>
        engine.IkeaListLights().pipe(Effect.map((lights) => io.lights(JSON.stringify(lights)))),
    });
    yield* context.schema.register({
      id: "GetLightState",
      name: "Get Light State",
      properties,
      io: (io) => ({
        name: io.data.out("deviceName", DataType.String, { name: "Device Name" }),
        reachable: io.data.out("reachable", DataType.Bool),
        on: io.data.out("on", DataType.Bool),
        brightness: io.data.out("brightness", DataType.Int, { name: "Brightness (0-254)" }),
        colorTemp: io.data.out("colorTemp", DataType.Option(DataType.Int), {
          name: "Temperature (Kelvin)",
        }),
        hexColor: io.data.out("hexColor", DataType.Option(DataType.String), { name: "Hex Color" }),
      }),
      run: ({ io, properties, engine }) =>
        Effect.gen(function* () {
          const light = yield* engine.IkeaGetLightState({ lightId: properties.light });
          io.name(light.name);
          io.reachable(light.reachable);
          io.on(light.on);
          io.brightness(light.brightness);
          io.colorTemp(Option.fromNullishOr(light.colorTemp));
          io.hexColor(Option.fromNullishOr(light.hexColor));
        }),
    });
  }),
});
export default plugin;
