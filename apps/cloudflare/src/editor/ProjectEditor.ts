import type * as S from "effect/Schema";

import { Project } from "@macrograph/core";
import { Editor, EditorRpc, Packages, ProjectPubSub } from "@macrograph/editor";
import { Persistence } from "@macrograph/persistence";
import { SqlitePersistence } from "@macrograph/persistence-sqlite";
import { Engine, HttpEndpoint, HttpIngress, Resource } from "@macrograph/plugin";
import KofiPlugin from "@macrograph/plugin-kofi";
import { KofiEngine } from "@macrograph/plugin-kofi/Definition";
import KofiDeployment from "@macrograph/plugin-kofi/Deployment/Webhook";
import TwitchPlugin from "@macrograph/plugin-twitch";
import { TwitchEngine } from "@macrograph/plugin-twitch/Definition";
import TwitchDeployment from "@macrograph/plugin-twitch/Deployment/Webhook";
import { EngineHost, ProjectExecutor } from "@macrograph/project-host";
import { RuntimeContext as AlchemyRuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import { Layer, Option, Queue, Redacted, Schema } from "effect";
import * as Effect from "effect/Effect";
import { constVoid } from "effect/Function";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { Rpc, RpcGroup, RpcMessage, RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { DurableObjectMigrationBundle } from "../DurableObjectMigrationBundle.ts";
import { DurableSqlitePersistence } from "../DurableSqlitePersistence.ts";
import { requestOrigin } from "../HttpOrigin.ts";
import { ObservabilityLayer } from "../Observability.ts";
import * as ExecutorPlugins from "../runtime/ExecutorPlugins.ts";
import ProjectRuntime from "../runtime/ProjectRuntime.ts";
import { AppCredentialsLayer as TwitchAppCredentialsLayer } from "../Twitch.ts";
import CloudAuth from "./CloudAuth.ts";

const sqliteSchemaPath = "../../packages/persistence-sqlite/src/schema.ts";
const WorkspaceRpcs = EditorRpc.EditorRpcs.merge(KofiEngine.ClientRpcs, TwitchEngine.ClientRpcs);
const editorIdentityKey = "editor-identity";

export default class ProjectEditor extends Cloudflare.DurableObject<ProjectEditor>()(
  "ProjectEditor",
  Effect.gen(function* () {
    const editorSchema = yield* Drizzle.Schema("ProjectEditorSchema", {
      schema: sqliteSchemaPath,
      dialect: "sqlite",
      out: "../../packages/persistence-sqlite/drizzle",
    });
    const migrations = yield* DurableObjectMigrationBundle.bindMigrations(
      "ProjectEditorMigrations",
      { migrationsDir: editorSchema.out },
    );
    const durableState = yield* Cloudflare.DurableObjectState;
    const projectRuntimes = yield* ProjectRuntime;
    const cloudAuths = yield* CloudAuth;

    const AppLayer = Editor.defaultLayer
      .pipe(Layer.provideMerge(Packages.defaultLayer))
      .pipe(Layer.provideMerge(ProjectPubSub.defaultLayer))
      .pipe(
        Layer.provideMerge(
          SqlitePersistence.layer.pipe(
            Layer.provide(Layer.unwrap(Effect.map(migrations, DurableSqlitePersistence.layer))),
            Persistence.withMemoryBuffer,
          ),
        ),
      );

    return Effect.gen(function* () {
      const editor = yield* Editor.Service;
      const persistence = yield* Persistence.Service;
      const runtimeContext = yield* Effect.context<AlchemyRuntimeContext>();
      const storedIdentity = yield* durableState.storage
        .get<{
          readonly projectId?: string;
          readonly sessionId?: string;
          readonly publicOrigin?: string;
        }>(editorIdentityKey)
        .pipe(Effect.provide(runtimeContext));
      let activeProjectId = storedIdentity?.projectId;
      let activeSessionId = storedIdentity?.sessionId;
      let publicOrigin = storedIdentity?.publicOrigin ?? "http://localhost:1337/runtime";

      const credentials = {
        get: Effect.suspend(() =>
          activeSessionId === undefined
            ? Effect.succeed([])
            : cloudAuths.getByName(activeSessionId).getCredentials(),
        ),
        refresh: (provider: string, id: string) =>
          activeSessionId === undefined
            ? Effect.die("Macrograph Cloud is not connected")
            : cloudAuths.getByName(activeSessionId).refreshCredential(provider, id),
        subscribe: () => Effect.void,
      };

      const configureRequest = (request: HttpServerRequest.HttpServerRequest) =>
        Effect.gen(function* () {
          const url = new URL(request.url, "http://localhost:1337");
          activeProjectId = url.searchParams.get("projectId") ?? activeProjectId;
          activeSessionId =
            url.searchParams.get("sessionId") ??
            request.headers["x-macrograph-session-id"] ??
            activeSessionId;
          publicOrigin =
            url.searchParams.get("publicOrigin") ??
            request.headers["x-macrograph-public-origin"] ??
            `${requestOrigin(request)}/runtime`;
          yield* durableState.storage
            .put(editorIdentityKey, {
              ...(activeProjectId === undefined ? {} : { projectId: activeProjectId }),
              ...(activeSessionId === undefined ? {} : { sessionId: activeSessionId }),
              publicOrigin,
            })
            .pipe(Effect.provide(runtimeContext));
        });

      const reconcileEditorIngressRaw = Effect.fnUntraced(function* (
        engines: Readonly<Record<string, unknown>>,
      ) {
        if (activeProjectId === undefined) return [];
        const result = yield* projectRuntimes.getByName(activeProjectId).preview({
          projectId: activeProjectId,
          publicOrigin,
          previewId: "editor",
          engines,
        });
        return result.endpoints;
      });
      const reconcileEditorIngress = (engines: Readonly<Record<string, unknown>>) =>
        reconcileEditorIngressRaw(engines).pipe(Effect.provide(runtimeContext), Effect.orDie);

      const endpointHostLayer = Layer.succeed(
        HttpEndpoint.Host,
        HttpEndpoint.Host.of({
          ensure: (handler, options) =>
            projectRuntimes
              .getByName(activeProjectId ?? "unknown")
              .getEndpoint(handler.id, options.instanceKey)
              .pipe(
                Effect.provide(runtimeContext),
                Effect.flatMap((endpoint) =>
                  endpoint === undefined
                    ? Effect.fail(
                        new HttpEndpoint.ProvisionError({
                          cause: `Endpoint ${handler.id}/${options.instanceKey} is not reconciled`,
                        }),
                      )
                    : Schema.decodeUnknownEffect(handler.metadata)(endpoint.metadata).pipe(
                        Effect.map((metadata) => ({ ...endpoint, metadata })),
                        Effect.mapError((cause) => new HttpEndpoint.ProvisionError({ cause })),
                      ),
                ),
              ),
          get: (handler, instanceKey) =>
            projectRuntimes
              .getByName(activeProjectId ?? "unknown")
              .getEndpoint(handler.id, instanceKey)
              .pipe(
                Effect.provide(runtimeContext),
                Effect.flatMap((endpoint) =>
                  endpoint === undefined
                    ? Effect.succeed(Option.none())
                    : Schema.decodeUnknownEffect(handler.metadata)(endpoint.metadata).pipe(
                        Effect.map((metadata) => Option.some({ ...endpoint, metadata })),
                        Effect.mapError((cause) => new HttpEndpoint.ProvisionError({ cause })),
                      ),
                ),
              ),
          remove: () => Effect.void,
          lookup: (endpointId) =>
            projectRuntimes
              .getByName(activeProjectId ?? "unknown")
              .lookupEndpoint(endpointId)
              .pipe(Effect.provide(runtimeContext), Effect.map(Option.fromNullishOr)),
        }),
      );

      const twitchDependencies = Layer.mergeAll(
        FetchHttpClient.layer,
        endpointHostLayer,
        TwitchAppCredentialsLayer,
        Layer.succeed(HttpEndpoint.SecretStore, {
          upsert: (endpointId) =>
            projectRuntimes
              .getByName(activeProjectId ?? "unknown")
              .upsertEndpointSecret(endpointId)
              .pipe(Effect.provide(runtimeContext), Effect.map(Redacted.make)),
        }),
      );

      const previewEvent = Effect.fnUntraced(function* (event: {
        readonly pluginId: string;
        readonly payloadJson: string;
      }) {
        const project = yield* persistence.loadProject();
        const executor = yield* ProjectExecutor.make(project, {
          plugins: ExecutorPlugins.registry,
        });
        const payload = yield* Effect.try({
          try: () => JSON.parse(event.payloadJson),
          catch: (cause) => cause,
        });
        yield* ExecutorPlugins.registry.handle(executor, event.pluginId, payload);
      }, Effect.orDie);

      const HttpIngressHostLayer = Layer.succeed(EngineHost.HttpIngressHost, {
        reconcile: (pluginId, state) =>
          persistence.loadProject().pipe(
            Effect.flatMap((project) =>
              reconcileEditorIngress({
                ...project.engines,
                [pluginId]: state,
              }),
            ),
            Effect.orDie,
          ),
      });
      const hostDeployment = <
        ResourceType extends Resource.ResourceClass<any, any, any>,
        Event extends { _tag: string },
        Storage extends S.Codec<unknown, unknown, never, never>,
        Rpcs extends Rpc.Any,
        ClientState extends S.Top,
        ClientRpcs extends Rpc.Any,
        EngineLayer extends Layer.Layer<
          Engine.Instance<ResourceType, Rpcs, ClientState, ClientRpcs>,
          never,
          Engine.EngineContext<ResourceType, Event, Storage>
        >,
        Handlers extends ReadonlyArray<HttpIngress.Live<unknown, unknown>>,
        RequirementsError,
      >(
        deployment: Engine.HttpIngressDeployment<
          Engine.Def<ResourceType, Event, Storage, Rpcs, ClientState, ClientRpcs>,
          EngineLayer,
          Handlers,
          RequirementsError
        >,
      ) => {
        const context = EngineHost.editorHttpIngressContextLayer(deployment, {
          emit: () => Effect.void,
        });
        return EngineHost.layer(deployment, context);
      };
      const EngineClientHandlersLayer = Layer.mergeAll(
        hostDeployment(KofiDeployment),
        hostDeployment({
          ...TwitchDeployment,
          layer: TwitchDeployment.layer.pipe(Layer.provide(twitchDependencies)),
        }),
      ).pipe(
        Layer.provide(HttpIngressHostLayer),
        Layer.provide(Layer.succeed(Engine.Credentials, credentials)),
      );
      const MountPlugins = Layer.effectDiscard(
        Effect.gen(function* () {
          const kofi = yield* KofiEngine;
          const twitch = yield* TwitchEngine;
          yield* EngineHost.mount(KofiPlugin, KofiDeployment, kofi.client.state);
          yield* EngineHost.mount(TwitchPlugin, TwitchDeployment, twitch.client.state);
        }),
      ).pipe(Layer.provideMerge(EngineClientHandlersLayer));
      const RpcLayer = Layer.mergeAll(
        RpcSerialization.layerJsonRpc(),
        EditorRpc.handlerLayer,
        MountPlugins,
      );

      const rpcWs = yield* makeRpcServerHttpEffectWebsocket(WorkspaceRpcs).pipe(
        Effect.provide(RpcLayer),
      );

      const rpcHttp = yield* RpcServer.toHttpEffect(WorkspaceRpcs).pipe(Effect.provide(RpcLayer));

      const snapshot = Effect.fnUntraced(function* (name: string) {
        yield* persistence.loadProject().pipe(
          Effect.catchTag("ProjectNotFoundError", () =>
            persistence.saveProject({ ...Project.empty(), name }),
          ),
          Effect.orDie,
        );
        return yield* persistence.loadProject().pipe(Effect.orDie);
      });

      const fetch = Layer.mergeAll(
        HttpRouter.add("GET", "/", Effect.succeed(HttpServerResponse.text("Hello world!"))),
        HttpRouter.add(
          "*",
          "/rpc",
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            yield* configureRequest(request);
            const name = request.headers["x-macrograph-project-name"] ?? "New Project";
            const project = yield* persistence.loadProject().pipe(
              Effect.catchTag("ProjectNotFoundError", () =>
                persistence
                  .saveProject({ ...Project.empty(), name })
                  .pipe(Effect.andThen(persistence.loadProject())),
              ),
              Effect.orDie,
            );
            yield* reconcileEditorIngress(project.engines).pipe(
              Effect.flatMap(editor.engine.setEndpoints),
            );

            if (request.headers.upgrade?.toLowerCase() === "websocket") {
              return yield* rpcWs.httpEffect;
            }

            return yield* rpcHttp;
          }),
        ),
      ).pipe(HttpRouter.toHttpEffect, Effect.provide(ObservabilityLayer));

      return {
        fetch,
        previewEvent,
        snapshot,
        ...rpcWs.handlers,
      };
    }).pipe(Effect.provide(AppLayer), Effect.provide(FetchHttpClient.layer));
  }).pipe(Effect.provide(ObservabilityLayer)),
) {}

type SocketAttachment = {
  uuid: string;
};

export const makeRpcServerHttpEffectWebsocket = Effect.fnUntraced(function* <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options?: {
    readonly disableTracing?: boolean | undefined;
    readonly spanPrefix?: string | undefined;
    readonly spanAttributes?: Record<string, unknown> | undefined;
    readonly disableFatalDefects?: boolean | undefined;
  },
) {
  const { onSocket, protocol, handlers } = yield* Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;

    const serialization = yield* RpcSerialization.RpcSerialization;
    const disconnects = yield* Queue.make<number>();

    let clientId = 0;
    const clients = new Map<
      number,
      {
        readonly write: (bytes: RpcMessage.FromServerEncoded) => Effect.Effect<void>;
        readonly webSocketMessage: (message: string | ArrayBuffer) => Effect.Effect<void>;
        readonly webSocketClose: (code: number, reason: string) => Effect.Effect<void>;
      }
    >();
    const uuidToId = new Map<string, number>();
    const clientIds = new Set<number>();
    const sessions = new Map<string, Cloudflare.WebSocket>();

    const onSocket = Effect.fnUntraced(function* (socket: Cloudflare.WebSocket, uuid?: string) {
      const id = clientId++;
      let _uuid = uuid;

      if (!_uuid) {
        _uuid = crypto.randomUUID();
        socket.serializeAttachment<SocketAttachment>({ uuid: _uuid });
      }

      uuidToId.set(_uuid, id);
      sessions.set(_uuid, socket);

      const parser = serialization.makeUnsafe();

      const writeRaw = socket.send;
      const write = (response: RpcMessage.FromServerEncoded) => {
        try {
          const encoded = parser.encode(response);
          if (encoded === undefined) {
            return Effect.void;
          }
          return Effect.orDie(writeRaw(encoded));
        } catch (cause) {
          return Effect.orDie(writeRaw(parser.encode(RpcMessage.ResponseDefectEncoded(cause))!));
        }
      };
      clients.set(id, {
        write,
        webSocketClose: () => Effect.void,
        webSocketMessage: (data) => {
          try {
            const decoded = parser.decode(
              typeof data === "string" ? data : new Uint8Array(data),
            ) as ReadonlyArray<RpcMessage.FromClientEncoded>;
            if (decoded.length === 0) return Effect.void;
            let i = 0;
            return Effect.whileLoop({
              while: () => i < decoded.length,
              body() {
                const message = decoded[i++];
                // if (message._tag === "Request" && headers) {
                // 	; (message as Types.Mutable<RpcMessage.RequestEncoded>).headers = headers.concat(message.headers)
                // }
                return writeRequest(id, message);
              },
              step: constVoid,
            });
          } catch (cause) {
            return writeRaw(parser.encode(RpcMessage.ResponseDefectEncoded(cause))!);
          }
        },
      });
      clientIds.add(id);
    });

    for (const socket of yield* state.getWebSockets()) {
      const data = socket.deserializeAttachment<SocketAttachment>();
      console.log("restoring socket", data);
      if (data) yield* onSocket(socket, data.uuid);
    }

    let writeRequest!: (
      clientId: number,
      message: RpcMessage.FromClientEncoded,
    ) => Effect.Effect<void>;

    const protocol = yield* RpcServer.Protocol.make((writeRequest_) => {
      writeRequest = writeRequest_;
      return Effect.succeed({
        disconnects,
        send: (clientId, response) => {
          const client = clients.get(clientId);
          if (!client) return Effect.void;
          return Effect.orDie(client.write(response));
        },
        end(_clientId) {
          return Effect.void;
        },
        clientIds: Effect.sync(() => clientIds),
        initialMessage: Effect.succeedNone,
        supportsAck: false,
        supportsTransferables: false,
        supportsSpanPropagation: true,
      });
    });

    return {
      protocol,
      onSocket,
      handlers: {
        webSocketMessage: (
          socket: Cloudflare.WebSocket,
          message: string | ArrayBuffer,
        ): Effect.Effect<boolean> => {
          const attachment = socket.deserializeAttachment<SocketAttachment>();
          if (!attachment) return Effect.succeed(false);

          const client = clients.get(uuidToId.get(attachment.uuid)!);
          if (!client) return Effect.succeed(false);

          return client.webSocketMessage(message).pipe(Effect.as(true));
        },
        webSocketClose: (
          socket: Cloudflare.WebSocket,
          code: number,
          reason: string,
        ): Effect.Effect<boolean> => {
          const attachment = socket.deserializeAttachment<SocketAttachment>();
          if (!attachment) return Effect.succeed(false);

          const client = clients.get(uuidToId.get(attachment.uuid)!);
          if (!client) return Effect.succeed(false);

          return client.webSocketClose(code, reason).pipe(Effect.as(true));
        },
      },
    } as const;
  });

  const httpEffect = Effect.gen(function* () {
    const [response, socket] = yield* Cloudflare.upgrade();

    yield* onSocket(socket);

    return response;
  });

  yield* RpcServer.make(group, options).pipe(
    Effect.provideService(RpcServer.Protocol, protocol),
    Effect.forkDetach,
  );

  return { httpEffect, handlers };
});
