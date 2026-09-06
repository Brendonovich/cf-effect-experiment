import type * as S from "effect/Schema";
import type { Rpc } from "effect/unstable/rpc";

import { Editor } from "@macrograph/editor";
import { Persistence } from "@macrograph/persistence";
import { Engine, Resource, type Module } from "@macrograph/module";
import { EngineHost, ModuleMount } from "@macrograph/project-host";
import { Context, Effect, Layer, Option, Ref, Scope } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { ProjectExecution } from "./ProjectExecution.ts";

type RpcHttpEffect = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  Scope.Scope | HttpServerRequest.HttpServerRequest
>;

/** Registers and resolves scoped HTTP RPC handlers for modules. */
export class Service extends Context.Service<
  Service,
  {
    readonly get: (moduleId: string) => Effect.Effect<Option.Option<RpcHttpEffect>>;
    readonly register: (
      moduleId: string,
      rpc: RpcHttpEffect,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("macrograph/server/ModuleHost") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const rpcs = yield* Ref.make<ReadonlyMap<string, RpcHttpEffect>>(new Map());
    return Service.of({
      get: (moduleId) =>
        Ref.get(rpcs).pipe(Effect.map((current) => Option.fromNullishOr(current.get(moduleId)))),
      register: (moduleId, rpc) =>
        Effect.gen(function* () {
          const registered = yield* Ref.modify(rpcs, (current) => {
            if (current.has(moduleId)) return [false, current];
            const next = new Map(current);
            next.set(moduleId, rpc);
            return [true, next];
          });
          if (!registered)
            return yield* Effect.die(`Module RPC group already registered: ${moduleId}`);
          yield* Effect.addFinalizer(() =>
            Ref.update(rpcs, (current) => {
              if (current.get(moduleId) !== rpc) return current;
              const next = new Map(current);
              next.delete(moduleId);
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
        "/module/:moduleId/rpc",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (!(yield* authorize(request)))
            return HttpServerResponse.text("Forbidden", { status: 403 });
          const moduleId = (yield* HttpRouter.RouteContext).params.moduleId;
          if (moduleId === undefined)
            return HttpServerResponse.text("Module not found", { status: 404 });
          const rpc = yield* registry.get(moduleId);
          return Option.isNone(rpc)
            ? HttpServerResponse.text("Module not found", { status: 404 })
            : yield* rpc.value;
        }),
      );
    }),
  );

export const moduleLayer = (module: Module.Module<never>) =>
  Layer.effectDiscard(
    Effect.flatMap(ProjectExecution.Service, (executor) => ModuleMount.register(executor, module)),
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
  const module = deployment.module;
  const context = Layer.unwrap(
    Effect.gen(function* () {
      const executor = yield* ProjectExecution.Service;
      const options = {
        emit: (event: Event) =>
          executor
            .handleEvent(module, event as Engine.EventOf<typeof deployment.definition>)
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logError(`Project executor failed to handle ${module.id} event`, cause),
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
      yield* ModuleMount.register(executor, module, deployment, instance.client.state);
      yield* registry.register(
        module.id,
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

export * as ModuleHost from "./ModuleHost.ts";
