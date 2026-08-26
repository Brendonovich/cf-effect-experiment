import * as Engine from "@macrograph/plugin/Engine";
import { Array, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export class TickEvent extends Schema.TaggedClass<TickEvent>()("TickEvent", {
  tick: Schema.Int,
}) {}

export const ClientState = Schema.Struct({ running: Schema.Boolean });

export class ClientRpcs extends RpcGroup.make(Rpc.make("StartTick"), Rpc.make("StopTick")) {}

export class UtilitiesEngine extends Engine.make({
  events: Array.empty<TickEvent>(),
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
