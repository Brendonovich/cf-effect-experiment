import { Engine, Resource } from "@macrograph/plugin";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const DeviceId = Schema.String.pipe(Schema.brand("ElgatoKeyLightDeviceId"));
export type DeviceId = typeof DeviceId.Type;

export const DeviceDefinition = Schema.Struct({
  id: DeviceId,
  name: Schema.String,
  url: Schema.String,
  timeoutMs: Schema.Int,
});
export type DeviceDefinition = typeof DeviceDefinition.Type;

export class KeyLightFailure extends Schema.TaggedError<KeyLightFailure>()(
  "ElgatoKeyLightFailure",
  { reason: Schema.String },
) {}

export const LightState = Schema.Struct({
  on: Schema.Boolean,
  brightness: Schema.Int,
  kelvin: Schema.Int,
});
export type LightState = typeof LightState.Type;

export const StatePatch = Schema.Struct({
  on: Schema.optional(Schema.Boolean),
  brightness: Schema.optional(Schema.Int),
  kelvin: Schema.optional(Schema.Int),
});
export type StatePatch = typeof StatePatch.Type;

export const Operation = Schema.Union([
  Schema.Struct({ type: Schema.Literal("set"), state: StatePatch }),
  Schema.Struct({ type: Schema.Literal("toggle") }),
  Schema.Struct({ type: Schema.Literal("brightness"), delta: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("temperature"), delta: Schema.Int }),
]);
export type Operation = typeof Operation.Type;

export class KeyLightDevice extends Resource.make<KeyLightDevice, DeviceId>()(
  "ElgatoKeyLightDevice",
  { name: "Key Light", description: "A manually configured Elgato Key Light HTTP device." },
) {}

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("ElgatoKeyLightAddDevice", {
    payload: Schema.Struct({ name: Schema.String, url: Schema.String, timeoutMs: Schema.Int }),
    success: DeviceId,
    error: KeyLightFailure,
  }),
  Rpc.make("ElgatoKeyLightUpdateDevice", {
    payload: DeviceDefinition,
    error: KeyLightFailure,
  }),
  Rpc.make("ElgatoKeyLightRemoveDevice", {
    payload: Schema.Struct({ id: DeviceId }),
    error: KeyLightFailure,
  }),
  Rpc.make("ElgatoKeyLightTestDevice", {
    payload: Schema.Struct({ id: DeviceId }),
    success: LightState,
    error: KeyLightFailure,
  }),
) {}

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("ElgatoKeyLightGetState", {
    payload: Schema.Struct({ deviceId: DeviceId }),
    success: LightState,
    error: KeyLightFailure,
  }),
  Rpc.make("ElgatoKeyLightUpdateState", {
    payload: Schema.Struct({ deviceId: DeviceId, operation: Operation }),
    success: LightState,
    error: KeyLightFailure,
  }),
) {}

export const RuntimeStorage = Schema.Struct({ devices: Schema.Array(DeviceDefinition) });
export const ClientState = RuntimeStorage;

export class KeyLightEngine extends Engine.make({
  resources: [KeyLightDevice],
  storage: RuntimeStorage,
  initialStorage: { devices: [] },
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
