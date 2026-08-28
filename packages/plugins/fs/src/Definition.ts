import * as Engine from "@macrograph/plugin/Engine";
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export class DirectoryFailure extends Schema.TaggedError<DirectoryFailure>()(
  "FilesystemDirectoryFailure",
  { reason: Schema.String },
) {}

export class FileFailure extends Schema.TaggedError<FileFailure>()("FilesystemFileFailure", {
  reason: Schema.String,
}) {}

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("FilesystemList", {
    payload: Schema.Struct({ path: Schema.String, kind: Schema.Literals(["File", "Directory"]) }),
    success: Schema.Array(Schema.String),
    error: DirectoryFailure,
  }),
  Rpc.make("FilesystemReadText", {
    payload: Schema.Struct({ path: Schema.String }),
    success: Schema.String,
    error: FileFailure,
  }),
  Rpc.make("FilesystemWriteText", {
    payload: Schema.Struct({ path: Schema.String, text: Schema.String }),
    error: FileFailure,
  }),
) {}

export class ClientRpcs extends RpcGroup.make() {}
export const ClientState = Schema.Struct({});

export class FilesystemEngine extends Engine.make({
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
