import { Engine, Resource } from "@macrograph/plugin";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const DeviceId = Schema.String.pipe(Schema.brand("LIFXDeviceId"));
export type DeviceId = typeof DeviceId.Type;

export const Device = Schema.Struct({
  id: DeviceId,
  name: Schema.String,
  address: Schema.String,
  port: Schema.Int,
});
export type Device = typeof Device.Type;
export const RuntimeStorage = Schema.Struct({ devices: Schema.Array(Device), timeout: Schema.Int });
export const ClientState = RuntimeStorage;
export const initialStorage: typeof RuntimeStorage.Type = { devices: [], timeout: 2000 };

export const Color = Schema.Struct({
  hue: Schema.Number,
  saturation: Schema.Number,
  brightness: Schema.Number,
  kelvin: Schema.Int,
});
export type Color = typeof Color.Type;
export const LightState = Schema.Struct({
  ...Color.fields,
  label: Schema.String,
  power: Schema.Boolean,
  hex: Schema.String,
});

export class LIFXFailure extends Schema.TaggedError<LIFXFailure>()("LIFXFailure", {
  reason: Schema.String,
}) {}

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("LIFXConfigure", { payload: RuntimeStorage, error: LIFXFailure }),
) {}

const target = { deviceId: DeviceId };
const transition = { ...target, duration: Schema.Int };
export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("LIFXGetState", {
    payload: Schema.Struct(target),
    success: LightState,
    error: LIFXFailure,
  }),
  Rpc.make("LIFXSetPower", {
    payload: Schema.Struct({ ...transition, power: Schema.Boolean }),
    error: LIFXFailure,
  }),
  Rpc.make("LIFXSetColor", {
    payload: Schema.Struct({ ...transition, color: Color }),
    error: LIFXFailure,
  }),
  Rpc.make("LIFXSetBrightness", {
    payload: Schema.Struct({ ...transition, brightness: Schema.Number }),
    error: LIFXFailure,
  }),
  Rpc.make("LIFXSetKelvin", {
    payload: Schema.Struct({ ...transition, kelvin: Schema.Int, brightness: Schema.Number }),
    error: LIFXFailure,
  }),
) {}

export class LIFXLight extends Resource.make<LIFXLight, DeviceId>()("LIFXLight", {
  name: "LIFX Light",
  description: "A manually configured LIFX LAN light reachable from the server.",
}) {}

export class LIFXEngine extends Engine.make({
  resources: [LIFXLight],
  storage: RuntimeStorage,
  initialStorage,
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
