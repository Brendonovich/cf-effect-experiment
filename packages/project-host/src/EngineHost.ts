import type * as S from "effect/Schema";
import type { Rpc } from "effect/unstable/rpc";

import { Persistence } from "@macrograph/persistence";
import {
  Engine,
  type HttpEndpoint,
  type Plugin,
  type Resource,
} from "@macrograph/plugin";
import { Context, Effect, Layer, Schema, Semaphore } from "effect";

import { Editor } from "@macrograph/editor";

export const contextLayer = <
  ResourceType extends Resource.ResourceClass<any, any, any>,
  Event extends { _tag: string },
  Storage extends S.Codec<unknown, unknown, never, never>,
  Rpcs extends Rpc.Any,
  ClientState extends S.Top,
  ClientRpcs extends Rpc.Any,
>(
  definition: Engine.Def<ResourceType, Event, Storage, Rpcs, ClientState, ClientRpcs>,
  options: {
    readonly storage: {
      readonly get: Effect.Effect<Storage["Type"]>;
      readonly save: (state: Storage["Type"]) => Effect.Effect<void>;
    };
    readonly reconcile: (
      state: Storage["Type"],
    ) => Effect.Effect<ReadonlyArray<HttpEndpoint.Routed>>;
    readonly setEndpoints: (endpoints: ReadonlyArray<HttpEndpoint.Routed>) => Effect.Effect<void>;
    readonly resource: Engine.ToLayerCtx<ResourceType, Event, Storage>["resource"];
    readonly credentials: Engine.ToLayerCtx<ResourceType, Event, Storage>["credentials"];
    readonly client: Engine.ToLayerCtx<ResourceType, Event, Storage>["client"];
    readonly emit: Engine.ToLayerCtx<ResourceType, Event, Storage>["emit"];
  },
) =>
  Layer.effect(
    definition.EngineContext,
    Effect.gen(function* () {
      const lock = yield* Semaphore.make(1);
      const save = (state: Storage["Type"]) =>
        options.storage
          .save(state)
          .pipe(Effect.andThen(options.reconcile(state)), Effect.flatMap(options.setEndpoints));

      return definition.EngineContext.of({
        storage: {
          get: options.storage.get,
          set: (state) => save(state).pipe(lock.withPermit),
          update: (f) =>
            options.storage.get.pipe(Effect.map(f), Effect.flatMap(save), lock.withPermit),
        },
        resource: options.resource,
        credentials: options.credentials,
        client: options.client,
        emit: options.emit,
      });
    }),
  );

// Implementations own the complete HTTP ingress lifecycle; engines invoke reconciliation directly.
export class HttpIngressHost extends Context.Service<
  HttpIngressHost,
  {
    readonly reconcile: (
      pluginId: string,
      state: unknown,
    ) => Effect.Effect<ReadonlyArray<HttpEndpoint.Routed>>;
  }
>()("@macrograph/project-host/EngineHost/HttpIngressHost") {}

type DeploymentRef<Definition extends Engine.AnyDef> = {
  readonly pluginId: string;
  readonly definition: Definition;
};

type EditorContextOptions<
  ResourceType extends Resource.ResourceClass<any, any, any>,
  Event extends { _tag: string },
  Storage extends S.Codec<unknown, unknown, never, never>,
> = {
  readonly emit: Engine.ToLayerCtx<ResourceType, Event, Storage>["emit"];
  readonly resource?: Engine.ToLayerCtx<ResourceType, Event, Storage>["resource"];
  readonly client?: Engine.ToLayerCtx<ResourceType, Event, Storage>["client"];
};

const editorLayer = <
  ResourceType extends Resource.ResourceClass<any, any, any>,
  Event extends { _tag: string },
  Storage extends S.Codec<unknown, unknown, never, never>,
  Rpcs extends Rpc.Any,
  ClientState extends S.Top,
  ClientRpcs extends Rpc.Any,
>(
  deployment: DeploymentRef<
    Engine.Def<ResourceType, Event, Storage, Rpcs, ClientState, ClientRpcs>
  >,
  options: EditorContextOptions<ResourceType, Event, Storage> & {
    readonly reconcile?: (
      state: Storage["Type"],
    ) => Effect.Effect<ReadonlyArray<HttpEndpoint.Routed>>;
  },
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const editor = yield* Editor.Service;
      const persistence = yield* Persistence.Service;
      const credentials = yield* Engine.Credentials;
      const definition = deployment.definition;

      return contextLayer(definition, {
        storage: {
          get: persistence.loadProject().pipe(
            Effect.flatMap((project) =>
              Schema.decodeUnknownEffect(definition.Storage)(
                project.engines[deployment.pluginId] ?? definition.InitialStorage,
              ),
            ),
            Effect.orDie,
          ),
          save: (state) =>
            editor.engine.setState(deployment.pluginId, state).pipe(Effect.asVoid, Effect.orDie),
        },
        reconcile: options.reconcile ?? (() => Effect.succeed([])),
        setEndpoints:
          options.reconcile === undefined ? () => Effect.void : editor.engine.setEndpoints,
        resource: options.resource ?? { refresh: () => Effect.void },
        credentials,
        client: options.client ?? { refresh: Effect.void },
        emit: options.emit,
      });
    }),
  );

export const editorContextLayer = <
  ResourceType extends Resource.ResourceClass<any, any, any>,
  Event extends { _tag: string },
  Storage extends S.Codec<unknown, unknown, never, never>,
  Rpcs extends Rpc.Any,
  ClientState extends S.Top,
  ClientRpcs extends Rpc.Any,
>(
  deployment: DeploymentRef<
    Engine.Def<ResourceType, Event, Storage, Rpcs, ClientState, ClientRpcs>
  >,
  options: EditorContextOptions<ResourceType, Event, Storage>,
) => editorLayer(deployment, options);

export const editorHttpIngressContextLayer = <
  ResourceType extends Resource.ResourceClass<any, any, any>,
  Event extends { _tag: string },
  Storage extends S.Codec<unknown, unknown, never, never>,
  Rpcs extends Rpc.Any,
  ClientState extends S.Top,
  ClientRpcs extends Rpc.Any,
>(
  deployment: DeploymentRef<
    Engine.Def<ResourceType, Event, Storage, Rpcs, ClientState, ClientRpcs>
  >,
  options: EditorContextOptions<ResourceType, Event, Storage>,
) =>
  Layer.unwrap(
    Effect.map(HttpIngressHost, (host) =>
      editorLayer(deployment, {
        ...options,
        reconcile: (state) => host.reconcile(deployment.pluginId, state),
      }),
    ),
  );

export const layer = <
  ResourceType extends Resource.ResourceClass<any, any, any>,
  Event extends { _tag: string },
  Storage extends S.Codec<unknown, unknown, never, never>,
  Rpcs extends Rpc.Any,
  ClientState extends S.Top,
  ClientRpcs extends Rpc.Any,
  EngineError,
  EngineServices,
  ContextError,
  ContextServices,
>(
  deployment: Engine.Deployment<
    Engine.Def<ResourceType, Event, Storage, Rpcs, ClientState, ClientRpcs>,
    Layer.Layer<
      Engine.Instance<ResourceType, Rpcs, ClientState, ClientRpcs>,
      EngineError,
      EngineServices
    >
  >,
  engineContext: Layer.Layer<
    Engine.EngineContext<ResourceType, Event, Storage>,
    ContextError,
    ContextServices
  >,
) => {
  const definition = deployment.definition;
  const engineLayer = deployment.layer.pipe(Layer.provide(engineContext));
  return Layer.unwrap(Effect.map(definition, (engine) => engine.client.rpcs)).pipe(
    Layer.provideMerge(engineLayer),
  );
};

export const mount = <Definition extends Engine.AnyDef>(
  plugin: Plugin.Plugin<Definition>,
  deployment: Engine.AnyDeploymentFor<Definition>,
  clientState: Effect.Effect<unknown>,
) =>
  Effect.gen(function* () {
    const editor = yield* Editor.Service;
    yield* editor.plugin(plugin, deployment);
    yield* editor.engine.hostClientState(plugin.id, clientState);
  });

export * as EngineHost from "./EngineHost.ts";
