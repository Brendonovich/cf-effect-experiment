import type * as S from "effect/Schema";
import { type Rpc, RpcTest } from "effect/unstable/rpc";

import { Persistence } from "@macrograph/persistence";
import * as Engine from "@macrograph/plugin/Engine";
import type * as HttpEndpoint from "@macrograph/plugin/HttpEndpoint";
import type * as Plugin from "@macrograph/plugin/Plugin";
import type * as Resource from "@macrograph/plugin/Resource";
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
  readonly reconcile?: (
    state: Storage["Type"],
  ) => Effect.Effect<ReadonlyArray<HttpEndpoint.Routed>>;
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
  options: EditorContextOptions<ResourceType, Event, Storage>,
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
        resource:
          options.resource ??
          {
            refresh: (resource) =>
              editor.engine
                .reloadResource(deployment.pluginId, resource.key)
                .pipe(Effect.catchTag("InvalidResourceError", () => Effect.void)),
          },
        credentials,
        client: options.client ?? { refresh: editor.engine.dirtyClientState(deployment.pluginId) },
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
  return Layer.unwrap(
    Effect.map(definition, (engine) =>
      Layer.merge(
        engine.client.rpcs,
        Layer.effectDiscard(
          Effect.gen(function* () {
            const editor = yield* Editor.Service;
            const runtime = yield* RpcTest.makeClient(definition.Rpcs).pipe(
              Effect.provide(engine.rpcs),
            );
            yield* editor.engine.hostRuntimeClient(deployment.pluginId, runtime);
            const resourceContext = yield* Layer.build(engine.resources);
            const resourceHandlers = resourceContext as unknown as Context.Context<
              Resource.Handler<string, Schema.Json>
            >;
            for (const resource of definition.Resource) {
              const handler = Context.get(resourceHandlers, resource.Handler);
              yield* editor.engine.hostResource(deployment.pluginId, resource.key, {
                values: handler.values,
                reload: handler.reload,
                changes: handler.changes,
              });
            }
          }),
        ),
      ),
    ),
  ).pipe(
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
    yield* editor.engine.hostClientState(
      plugin.id,
      clientState.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
        Effect.orDie,
      ),
    );
  });

export * as EngineHost from "./EngineHost.ts";
