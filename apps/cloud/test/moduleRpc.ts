import type { ModuleRegistry } from "@macrograph/module-host/core";

import { Engine, HttpEndpoint } from "@macrograph/module";
import { RequestFailure as OpenCodeFailure } from "@macrograph/module-opencode/Definition";
import { Effect, Layer, Option, Scope } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { RpcClient, type RpcGroup, RpcSerialization, type Rpc } from "effect/rpc";

import type * as CloudModules from "../src/modules/CloudModules.ts";

import { ModuleRpcRoutes } from "../src/editor/ModuleRpcRoutes.ts";

/** An editor host without ingress, credentials or OpenCode, for editor tests. */
export const testEditorHost: CloudModules.EditorHost = {
  credentials: Effect.runSync(
    Effect.service(Engine.Credentials).pipe(Effect.provide(Engine.emptyCredentialsLayer)),
  ),
  endpointHost: Layer.succeed(HttpEndpoint.Host, {
    ensure: () => Effect.die("Editor tests must not provision endpoints"),
    get: () => Effect.succeed(Option.none()),
    remove: () => Effect.void,
    lookup: () => Effect.succeed(Option.none()),
    secret: () => Effect.die("Editor tests have no endpoint secrets"),
  }),
  reconcile: () => Effect.succeed([]),
  reconnectIngress: Effect.void,
  openCode: {
    connectionTypes: ["managed", "remote"],
    resolve: () => Effect.fail(new OpenCodeFailure({ reason: "OpenCode runtime is unavailable" })),
  },
};

export const identity = (role: "owner" | "member" | "viewer", projectId = "project-1") => ({
  "x-macrograph-role": role,
  "x-macrograph-project-id": projectId,
  "x-macrograph-user-id": "user-1",
});

/**
 * An HTTP client that serves every request with `ModuleRpcRoutes` in this process, as the
 * Durable Object does behind the worker route. Response bodies stream within `scope`.
 */
export const routeClient = (
  registry: ModuleRegistry.Service["Service"],
  options: {
    readonly projectId: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly scope: Scope.Scope;
  },
) =>
  HttpClient.make((request, url) =>
    Effect.gen(function* () {
      const body = request.body._tag === "Uint8Array" ? request.body.body : undefined;
      const web = new Request(url, {
        method: request.method,
        headers: { ...request.headers, ...options.headers },
        ...(body === undefined ? {} : { body }),
      });
      const response = yield* ModuleRpcRoutes.serve(registry, {
        projectId: options.projectId,
      }).pipe(
        Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(web)),
        Effect.provideService(Scope.Scope, options.scope),
      );
      return HttpClientResponse.fromWeb(request, HttpServerResponse.toWeb(response));
    }),
  );

/** A module's RPC client over NDJSON, against `client`, at the path the worker forwards to. */
export const moduleClient = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  moduleId: string,
  client: HttpClient.HttpClient,
) =>
  Effect.gen(function* () {
    const protocol = yield* RpcClient.makeProtocolHttp(
      client.pipe(
        HttpClient.mapRequest(
          HttpClientRequest.setUrl(`http://project-editor.local/module/${moduleId}/rpc`),
        ),
      ),
    ).pipe(Effect.provideService(RpcSerialization.RpcSerialization, RpcSerialization.ndjson));
    return yield* RpcClient.make(group).pipe(Effect.provideService(RpcClient.Protocol, protocol));
  });
