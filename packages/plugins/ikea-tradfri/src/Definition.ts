import { Engine, Resource } from "@macrograph/plugin";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const LightId = Schema.Int.pipe(Schema.brand("IkeaLightId"));
export type LightId = typeof LightId.Type;
export class IkeaFailure extends Schema.TaggedError<IkeaFailure>()("IkeaFailure", {
  reason: Schema.String,
}) {
  get message() {
    return this.reason;
  }
}
export const Light = Schema.Struct({ id: LightId, name: Schema.String });
export const LightState = Schema.Struct({
  id: LightId,
  name: Schema.String,
  reachable: Schema.Boolean,
  on: Schema.Boolean,
  brightness: Schema.Int,
  colorTemp: Schema.optional(Schema.Int),
  hexColor: Schema.optional(Schema.String),
});
export type LightState = typeof LightState.Type;
export const StatePatch = Schema.Struct({
  on: Schema.optional(Schema.Boolean),
  brightness: Schema.optional(Schema.Int),
  colorTemp: Schema.optional(Schema.Int),
  hexColor: Schema.optional(Schema.String),
});
export type StatePatch = typeof StatePatch.Type;
export class IkeaLight extends Resource.make<IkeaLight, LightId>()("IkeaLight", {
  name: "TRADFRI Light",
  description: "A light enumerated by the configured TRADFRI gateway. Refresh lights in settings.",
}) {}

export const RuntimeStorage = Schema.Struct({
  host: Schema.String,
  timeoutMs: Schema.Int,
  identity: Schema.String,
  psk: Schema.String,
  lights: Schema.Array(Light),
});
export const initialStorage: typeof RuntimeStorage.Type = {
  host: "",
  timeoutMs: 10000,
  identity: "",
  psk: "",
  lights: [],
};
export const ClientState = Schema.Struct({
  host: Schema.String,
  timeoutMs: Schema.Int,
  hasCredentials: Schema.Boolean,
  connected: Schema.Boolean,
  lights: Schema.Array(Light),
});
export const initialClientState: typeof ClientState.Type = {
  host: "",
  timeoutMs: 10000,
  hasCredentials: false,
  connected: false,
  lights: [],
};
export class ClientRpcs extends RpcGroup.make(
  Rpc.make("IkeaPair", {
    payload: Schema.Struct({
      host: Schema.String,
      securityCode: Schema.String,
      timeoutMs: Schema.Int,
    }),
    error: IkeaFailure,
  }),
  Rpc.make("IkeaConfigure", {
    payload: Schema.Struct({ host: Schema.String, timeoutMs: Schema.Int }),
    error: IkeaFailure,
  }),
  Rpc.make("IkeaReconnect", { error: IkeaFailure }),
  Rpc.make("IkeaDisconnect", { error: IkeaFailure }),
  Rpc.make("IkeaForget", { error: IkeaFailure }),
  Rpc.make("IkeaRefreshLights", { success: Schema.Array(LightState), error: IkeaFailure }),
) {}
export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("IkeaListLights", { success: Schema.Array(LightState), error: IkeaFailure }),
  Rpc.make("IkeaGetLightState", {
    payload: Schema.Struct({ lightId: LightId }),
    success: LightState,
    error: IkeaFailure,
  }),
  Rpc.make("IkeaSetLightState", {
    payload: Schema.Struct({ lightId: LightId, state: StatePatch }),
    error: IkeaFailure,
  }),
) {}
export class IkeaEngine extends Engine.make({
  resources: [IkeaLight],
  storage: RuntimeStorage,
  initialStorage,
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
