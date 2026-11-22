import type { ModuleCatalog } from "@macrograph/module/ModuleCatalog";
import type * as S from "effect/Schema";

import { Editor } from "@macrograph/editor";
import { LiveRuntime } from "@macrograph/live-runtime";
import { Engine, Module, type Resource } from "@macrograph/module";
import { ModuleRegistry } from "@macrograph/module-host/ModuleRegistry";
import { Mounter } from "@macrograph/module-host/Mounter";
import { HostService } from "@macrograph/module/HostService";
import { ModuleAdminRpc } from "@macrograph/module/ModuleAdminRpc";
import { ModuleId } from "@macrograph/module/ModuleId";
import { Persistence } from "@macrograph/persistence";
import { EngineHost, ModuleMount } from "@macrograph/project-host";
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import {
  HttpClient,
  HttpPlatform,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";
import { type Rpc, RpcSerialization, RpcServer } from "effect/rpc";
import { Socket } from "effect/socket";
import { basename, dirname } from "node:path";

/** Host services (section 10) the self-hosted server provides to every module. */
export const hostServices: ReadonlyArray<HostService.Id> = HostService.ids;

/** The Effect services behind `hostServices`. Web Crypto (`crypto`) is a global. */
export type HostServices =
  | HttpClient.HttpClient
  | FileSystem.FileSystem
  | Path.Path
  | Socket.WebSocketConstructor
  | Engine.Credentials;

type AnyResource = Resource.ResourceClass<any, any, any>;
type AnyEvent = { _tag: string };
type AnyStorage = S.Codec<unknown, unknown, never, never>;
type LoadedDef = Engine.Def<AnyResource, AnyEvent, AnyStorage, Rpc.Any, S.Top, Rpc.Any>;

/**
 * The shape of a runtime-loaded deployment. Its engine layer may only require host services and
 * its engine context; anything else fails when the layer is built, which fails the mount.
 */
type LoadedDeployment = Engine.Deployment<
  LoadedDef,
  Layer.Layer<
    Engine.Instance<AnyResource, Rpc.Any, S.Top, Rpc.Any>,
    unknown,
    HostServices | Engine.EngineContext<AnyResource, AnyEvent, AnyStorage>
  >
>;

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === "object" && value !== null;

/** Checks the shape of a server entry's default export that has an engine. */
export const isDeployment = (value: unknown): value is LoadedDeployment =>
  isRecord(value) &&
  Layer.isLayer(value.layer) &&
  (typeof value.definition === "function" || isRecord(value.definition)) &&
  Engine.EngineTypeId in value.definition &&
  isRecord(value.module);

/** Checks the shape of a server entry's default export without an engine. */
export const isModule = (value: unknown): value is Module.Module<never> =>
  isRecord(value) && typeof value.effect === "function" && value.engine === undefined;

const mountDeployment = (deployment: Engine.Identified<LoadedDeployment>) =>
  Effect.gen(function* () {
    const executor = yield* LiveRuntime.Service;
    const module = deployment.module;
    const engineContext = EngineHost.editorContextLayer(deployment, {
      emit: (event) =>
        executor
          .handleEvent(module, event)
          .pipe(
            Effect.catchCause((cause) =>
              Effect.logError(`Project executor failed to handle ${module.id} event`, cause),
            ),
          ),
    });
    const context = yield* Layer.build(EngineHost.layer(deployment, engineContext));
    const instance = Context.get(context, deployment.definition);
    yield* ModuleMount.register(executor, module, deployment, instance.client.state);
    return yield* RpcServer.toHttpEffect(deployment.definition.ClientRpcs).pipe(
      Effect.provide(context),
      Effect.provideService(RpcSerialization.RpcSerialization, RpcSerialization.ndjson),
    );
  });

/**
 * Mounts evaluated module packages: editor, executor, engine host and a per-module NDJSON RPC
 * server, all in the scope the registry provides.
 */
export const mounterLayer = Layer.effect(Mounter.Service)(
  Effect.gen(function* () {
    // Only these services: the layer's own scope must not replace the module's scope.
    const services = Context.pick(
      HttpClient.HttpClient,
      FileSystem.FileSystem,
      Path.Path,
      Socket.WebSocketConstructor,
      Engine.Credentials,
      Editor.Service,
      Persistence.Service,
      LiveRuntime.Service,
    )(
      yield* Effect.context<
        HostServices | Editor.Service | Persistence.Service | LiveRuntime.Service
      >(),
    );
    return Mounter.Service.of({
      mount: (input) =>
        Effect.gen(function* () {
          const value = input.deployment;
          if (isDeployment(value)) {
            if ("httpIngress" in value)
              return yield* new Mounter.MountError({
                id: input.id,
                message: "Modules with HTTP ingress can't run on a self-hosted server",
              });
            const rpc = yield* mountDeployment(Engine.identify(input.id, value)).pipe(
              Effect.mapError(
                (error) => new Mounter.MountError({ id: input.id, message: String(error) }),
              ),
            );
            return { rpc: Option.some(rpc) };
          }
          if (isModule(value)) {
            const executor = yield* LiveRuntime.Service;
            yield* ModuleMount.register(executor, Module.identify(input.id, value));
            return { rpc: Option.none() };
          }
          return yield* new Mounter.MountError({
            id: input.id,
            message:
              "The server entry's default export is neither a deployment nor a module definition",
          });
        }).pipe(Effect.provide(services)),
    });
  }),
);

/** Catalog URLs are root-relative; the server may be served under a base path. */
export const withBasePath =
  (basePath: string) =>
  (entry: ModuleCatalog.Entry): ModuleCatalog.Entry => {
    if (basePath === "") return entry;
    const prefix = (url: string) => (url.startsWith("/") ? `${basePath}${url}` : url);
    return {
      ...entry,
      ...(entry.iconUrl === undefined ? {} : { iconUrl: prefix(entry.iconUrl) }),
      ...(entry.ui === undefined
        ? {}
        : {
            ui: { entryUrl: prefix(entry.ui.entryUrl), styleUrls: entry.ui.styleUrls.map(prefix) },
          }),
    };
  };

const notLoadedResponse = (error: ModuleAdminRpc.ModuleNotLoaded) =>
  HttpServerResponse.jsonUnsafe(Schema.encodeSync(ModuleAdminRpc.ModuleNotLoaded)(error), {
    status: 503,
    headers: { "cache-control": "no-store" },
  });

const notFound = HttpServerResponse.text("Module not found", {
  status: 404,
  headers: { "cache-control": "no-store" },
});

/** `/module/<namespace>/<publisher>/<name>/<kind>/<rest>` */
const parseModulePath = (url: string) => {
  const path = url.split("?", 1)[0] ?? "";
  const segments = path.split("/");
  // ["", "module", namespace, publisher, name, kind, ...rest]
  if (segments[1] !== "module" || segments.length < 6) return undefined;
  const id = ModuleId.parse(segments.slice(2, 5).join("/"));
  if (Option.isNone(id)) return undefined;
  const kind = segments[5];
  const rest = segments.slice(6).join("/");
  return { id: id.value, kind, rest, query: url.slice(path.length) };
};

/**
 * Serves `/module/:namespace/:publisher/:name/{rpc,ui/*,assets/*}` from the module registry.
 * Route setup is synchronous; the registry is only consulted per request.
 */
export const routes = (options: {
  readonly basePath: string;
  readonly canEditRequest: (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<boolean>;
}) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* ModuleRegistry.Service;
      const services = Context.pick(
        FileSystem.FileSystem,
        Path.Path,
        HttpPlatform.HttpPlatform,
      )(yield* Effect.context<FileSystem.FileSystem | Path.Path | HttpPlatform.HttpPlatform>());
      const router = (yield* HttpRouter.HttpRouter).prefixed(options.basePath);

      const serveRpc = (id: ModuleId.Id, rest: string, query: string) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (!(yield* options.canEditRequest(request)))
            return HttpServerResponse.text("Forbidden", { status: 403 });
          return yield* registry.rpcHandler(id).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.succeed(notFound),
                // Forward with the module prefix stripped.
                onSome: (handler) =>
                  handler.pipe(
                    Effect.provideService(
                      HttpServerRequest.HttpServerRequest,
                      request.modify({ url: `/${rest}${query}` }),
                    ),
                  ),
              }),
            ),
            Effect.catchTags({
              ModuleNotFound: () => Effect.succeed(notFound),
              ModuleNotLoaded: (error) => Effect.succeed(notLoadedResponse(error)),
            }),
          );
        });

      const serveStatic = (id: ModuleId.Id, kind: "ui" | "assets", rest: string) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (request.method !== "GET" && request.method !== "HEAD") return notFound;
          return yield* registry.staticFile(id, kind, rest).pipe(
            Effect.flatMap(
              Option.match({
                onNone: () => Effect.succeed(notFound),
                onSome: (file) =>
                  HttpStaticServer.make({
                    root: dirname(file.path),
                    index: undefined,
                    cacheControl: file.immutable
                      ? "public, max-age=31536000, immutable"
                      : "no-cache",
                  }).pipe(
                    Effect.flatMap((serve) =>
                      serve.pipe(
                        Effect.provideService(
                          HttpServerRequest.HttpServerRequest,
                          request.modify({ url: `/${encodeURIComponent(basename(file.path))}` }),
                        ),
                      ),
                    ),
                    Effect.map(HttpServerResponse.setHeader("x-content-type-options", "nosniff")),
                    Effect.catch(() => Effect.succeed(notFound)),
                    Effect.provide(services),
                  ),
              }),
            ),
            Effect.catchTags({
              ModuleNotFound: () => Effect.succeed(notFound),
              ModuleNotLoaded: (error) => Effect.succeed(notLoadedResponse(error)),
            }),
          );
        });

      yield* router.add(
        "*",
        "/module/*",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const parsed = parseModulePath(request.url);
          if (parsed === undefined) return notFound;
          switch (parsed.kind) {
            case "rpc":
              return yield* serveRpc(parsed.id, parsed.rest, parsed.query);
            case "ui":
            case "assets":
              return yield* serveStatic(parsed.id, parsed.kind, parsed.rest);
            default:
              return notFound;
          }
        }),
      );
    }),
  );

export * as ModuleHost from "./ModuleHost.ts";
