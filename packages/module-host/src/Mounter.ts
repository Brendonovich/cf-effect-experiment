import type { Manifest } from "@macrograph/module/Manifest";
import type { ModuleCatalog } from "@macrograph/module/ModuleCatalog";
import type { ModuleId } from "@macrograph/module/ModuleId";
import type { HttpServerRequest, HttpServerResponse } from "effect/http";

import { Context, type Effect, type Option, Schema, type Scope } from "effect";

/** Serves a module's RPCs. The host's `/module/...` route forwards requests with the prefix stripped. */
export type RpcHandler = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  Scope.Scope | HttpServerRequest.HttpServerRequest
>;

export interface Input {
  readonly id: ModuleId.Id;
  readonly manifest: Manifest.Model;
  readonly source: ModuleCatalog.SourceKind;
  /** The module folder, if it has one. */
  readonly root: Option.Option<string>;
  /**
   * The server entry's default export (`ModulePackage.serverEntryDefault`): a deployment, or a
   * module without an engine. The mounter checks its shape.
   */
  readonly deployment: unknown;
}

export interface Mounted {
  readonly rpc: Option.Option<RpcHandler>;
}

export class MountError extends Schema.TaggedError<MountError>()("MountError", {
  id: Schema.String,
  message: Schema.String,
}) {}

/**
 * Registers a module with the host: editor, executor, engine host layer and RPC server. Provided
 * by the host so the registry doesn't depend on editor or executor internals.
 *
 * Everything must be registered in the provided scope. The registry closes it on unload, and every
 * registration must undo itself then, or the module's code can't be garbage-collected.
 */
export class Service extends Context.Service<
  Service,
  {
    readonly mount: (input: Input) => Effect.Effect<Mounted, MountError, Scope.Scope>;
  }
>()("@macrograph/module-host/Mounter") {}

export * as Mounter from "./Mounter.ts";
