import * as Engine from "@macrograph/plugin/Engine";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export class CommandFailure extends Schema.TaggedError<CommandFailure>()("ShellCommandFailure", {
  reason: Schema.String,
}) {}

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("ShellExecute", {
    payload: Schema.Struct({ command: Schema.String }),
    error: CommandFailure,
  }),
) {}

export class ClientRpcs extends RpcGroup.make() {}
export const ClientState = Schema.Struct({ enabled: Schema.Boolean });

export class ShellEngine extends Engine.make({
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
