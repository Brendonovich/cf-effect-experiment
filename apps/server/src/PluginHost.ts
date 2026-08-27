import type * as S from "effect/Schema";
import type { Rpc } from "effect/unstable/rpc";

import { Editor } from "@macrograph/editor";
import { Persistence } from "@macrograph/persistence";
import { Engine, Resource, type Plugin } from "@macrograph/plugin";
import { EngineHost, PluginMount } from "@macrograph/project-host";
import { Context, Effect, Layer, Option, Ref, Scope } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { ProjectExecution } from "./ProjectExecution.ts";

type RpcHttpEffect = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  Scope.Scope | HttpServerRequest.HttpServerRequest
>;

/** Registers and resolves scoped HTTP RPC handlers for plugins. */
export class Service extends Context.Service<
  Service,
  {
    readonly get: (pluginId: string) => Effect.Effect<Option.Option<RpcHttpEffect>>;
    readonly register: (
      pluginId: string,
      rpc: RpcHttpEffect,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("macrograph/server/PluginHost") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const rpcs = yield* Ref.make<ReadonlyMap<string, RpcHttpEffect>>(new Map());
    return Service.of({
      get: (pluginId) =>
        Ref.get(rpcs).pipe(Effect.map((current) => Option.fromNullishOr(current.get(pluginId)))),
      register: (pluginId, rpc) =>
        Effect.gen(function* () {
          const registered = yield* Ref.modify(rpcs, (current) => {
            if (current.has(pluginId)) return [false, current];
            const next = new Map(current);
            next.set(pluginId, rpc);
            return [true, next];
          });
          if (!registered)
            return yield* Effect.die(`Plugin RPC group already registered: ${pluginId}`);
          yield* Effect.addFinalizer(() =>
            Ref.update(rpcs, (current) => {
              if (current.get(pluginId) !== rpc) return current;
              const next = new Map(current);
              next.delete(pluginId);
              return next;
            }),
          );
        }),
    });
  }),
);

export const rpcRoute = (
  basePath = "",
  authorize: (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<boolean> = () =>
    Effect.succeed(true),
) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* Service;
      const router = (yield* HttpRouter.HttpRouter).prefixed(basePath);
      yield* router.add(
        "*",
        "/plugin/:pluginId/rpc",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (!(yield* authorize(request)))
            return HttpServerResponse.text("Forbidden", { status: 403 });
          const pluginId = (yield* HttpRouter.RouteContext).params.pluginId;
          if (pluginId === undefined)
            return HttpServerResponse.text("Plugin not found", { status: 404 });
          const rpc = yield* registry.get(pluginId);
          return Option.isNone(rpc)
            ? HttpServerResponse.text("Plugin not found", { status: 404 })
            : yield* rpc.value;
        }),
      );
    }),
  );

export const pluginLayer = (plugin: Plugin.Plugin<never>) =>
  Layer.effectDiscard(
    Effect.flatMap(ProjectExecution.Service, (executor) => PluginMount.register(executor, plugin)),
  );

export const deploymentLayer = <
  ResourceType extends Resource.ResourceClass<any, any, any>,
  Event extends { _tag: string },
  Storage extends S.Codec<unknown, unknown, never, never>,
  Rpcs extends Rpc.Any,
  ClientState extends S.Top,
  ClientRpcs extends Rpc.Any,
  EngineError,
  EngineServices,
>(
  deployment: Engine.Deployment<
    Engine.Def<ResourceType, Event, Storage, Rpcs, ClientState, ClientRpcs>,
    Layer.Layer<
      Engine.Instance<ResourceType, Rpcs, ClientState, ClientRpcs>,
      EngineError,
      EngineServices
    >
  > & { readonly httpIngress?: never },
): Layer.Layer<
  Engine.Instance<ResourceType, Rpcs, ClientState, ClientRpcs> | Rpc.ToHandler<ClientRpcs>,
  EngineError,
  | Editor.Service
  | Persistence.Service
  | ProjectExecution.Service
  | Service
  | Engine.Credentials
  | Rpc.Middleware<ClientRpcs>
  | Rpc.ServicesServer<ClientRpcs>
  | RpcSerialization.RpcSerialization
  | Exclude<EngineServices, Engine.EngineContext<ResourceType, Event, Storage>>
> => {
  const plugin = deployment.plugin;
  const context = Layer.unwrap(
    Effect.gen(function* () {
      const executor = yield* ProjectExecution.Service;
      const options = {
        emit: (event: Event) =>
          executor
            .handleEvent(plugin, event as Engine.EventOf<typeof deployment.definition>)
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logError(`Project executor failed to handle ${plugin.id} event`, cause),
              ),
            ),
      };
      return EngineHost.editorContextLayer(deployment, options);
    }),
  );
  const engine = EngineHost.layer(deployment, context);
  const register = Layer.effectDiscard(
    Effect.gen(function* () {
      const executor = yield* ProjectExecution.Service;
      const instance = yield* deployment.definition;
      const registry = yield* Service;
      yield* PluginMount.register(executor, plugin, deployment, instance.client.state);
      yield* registry.register(
        plugin.id,
        yield* RpcServer.toHttpEffect(deployment.definition.ClientRpcs),
      );
    }),
  );
  return register.pipe(Layer.provideMerge(engine));
};

export const mount = <
  ResourceType extends Resource.ResourceClass<any, any, any>,
  Event extends { _tag: string },
  Storage extends S.Codec<unknown, unknown, never, never>,
  Rpcs extends Rpc.Any,
  ClientState extends S.Top,
  ClientRpcs extends Rpc.Any,
  EngineError,
  EngineServices,
>(
  deployment: Engine.Deployment<
    Engine.Def<ResourceType, Event, Storage, Rpcs, ClientState, ClientRpcs>,
    Layer.Layer<
      Engine.Instance<ResourceType, Rpcs, ClientState, ClientRpcs>,
      EngineError,
      EngineServices
    >
  > & { readonly httpIngress?: never },
): Effect.Effect<
  void,
  EngineError,
  | Editor.Service
  | Persistence.Service
  | ProjectExecution.Service
  | Service
  | Engine.Credentials
  | Rpc.Middleware<ClientRpcs>
  | Rpc.ServicesServer<ClientRpcs>
  | RpcSerialization.RpcSerialization
  | Scope.Scope
  | Exclude<EngineServices, Engine.EngineContext<ResourceType, Event, Storage>>
> => deploymentLayer(deployment).pipe(Layer.build, Effect.asVoid);

export * as PluginHost from "./PluginHost.ts";
