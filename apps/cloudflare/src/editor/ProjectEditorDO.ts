import type { CreateGraphRequest } from "@macrograph/cloud-api";
import type * as S from "effect/Schema";

import { Connection, Graph, Node, Package, Project } from "@macrograph/core";
import {
  DualProtocol,
  Editor,
  EditorAccess,
  EditorEvents,
  EditorRpc,
  EditorServer,
  Packages,
  Presence,
} from "@macrograph/editor";
import { Persistence } from "@macrograph/persistence";
import { SqlitePersistence } from "@macrograph/persistence-sqlite";
import { Credential, Engine, HttpEndpoint, HttpIngress, Resource } from "@macrograph/plugin";
import HttpClientPlugin from "@macrograph/plugin-http-client";
import { HttpClientEngine } from "@macrograph/plugin-http-client/Definition";
import HttpClientDeployment from "@macrograph/plugin-http-client/Deployment";
import KofiPlugin from "@macrograph/plugin-kofi";
import { KofiEngine } from "@macrograph/plugin-kofi/Definition";
import KofiDeployment from "@macrograph/plugin-kofi/Deployment/Webhook";
import TwitchPlugin from "@macrograph/plugin-twitch";
import { AccountId, TwitchEngine } from "@macrograph/plugin-twitch/Definition";
import TwitchDeployment from "@macrograph/plugin-twitch/Deployment/Webhook";
import { make as makeTwitchEngine } from "@macrograph/plugin-twitch/Engine";
import { EventSubEndpoint } from "@macrograph/plugin-twitch/EventSub/Webhook";
import UtilitiesPlugin from "@macrograph/plugin-utilities";
import { UtilitiesEngine } from "@macrograph/plugin-utilities/Definition";
import { make as makeUtilitiesEngine } from "@macrograph/plugin-utilities/Engine";
import { EngineHost } from "@macrograph/project-host";
import { RuntimeContext as AlchemyRuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import { HashMap, Layer, Option, Queue, Redacted, Schema, Scope, SubscriptionRef } from "effect";
import * as Effect from "effect/Effect";
import { constVoid } from "effect/Function";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { Rpc, RpcGroup, RpcMessage, RpcSerialization, RpcServer } from "effect/unstable/rpc";

import type * as CloudWorkerOperations from "../worker/CloudWorkerOperations.ts";

import { requestOrigin } from "../api/HttpOrigin.ts";
import CloudAuthDO, { type CredentialTransfer } from "../auth/CloudAuthDO.ts";
import { canMutateProject } from "../team/TeamAccess.ts";
import { DurableObjectMigrationBundle } from "./DurableObjectMigrationBundle.ts";
import { DurableSqlitePersistence } from "./DurableSqlitePersistence.ts";

const UtilitiesDeployment = Engine.deployment(
  UtilitiesPlugin,
  makeUtilitiesEngine({ startTicker: false }),
);

const sqliteSchemaPath = "../../packages/persistence-sqlite/src/schema.ts";
const HostedDeployments = [
  KofiDeployment,
  TwitchDeployment,
  UtilitiesDeployment,
  HttpClientDeployment,
] as const;
const WorkspaceRpcs = EditorServer.mergeRpcGroups(
  EditorRpc.EditorRpcs,
  ...HostedDeployments.map((deployment) => deployment.definition.ClientRpcs),
).middleware(EditorRpc.ConnectionMiddleware);
const editorIdentityKey = "editor-identity";

/**
 * Owns each project's live editing workspace. The DO keeps collaborators'
 * WebSockets, presence, and shared editor state together; a database can store
 * edits but would still need a live coordinator to broadcast changes.
 */
export default class ProjectEditorDO extends Cloudflare.DurableObject<ProjectEditorDO>()(
  "ProjectEditorDO",
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
    const workerEnvironment = yield* Cloudflare.WorkerEnvironment;
    const ingress = Cloudflare.Workers.makeRpcStub<CloudWorkerOperations.Service>(
      workerEnvironment?.IngressWorker,
    );
    const cloudAuths = yield* CloudAuthDO;

    const AppLayer = Editor.defaultLayer
      .pipe(Layer.provideMerge(Packages.defaultLayer))
      .pipe(
        Layer.provideMerge(
          SqlitePersistence.layer.pipe(
            Layer.provide(Layer.unwrap(Effect.map(migrations, DurableSqlitePersistence.layer))),
            Persistence.withMemoryBuffer,
          ),
        ),
      )
      .pipe(Layer.provideMerge(Presence.layer));

    return Effect.gen(function* () {
      const editor = yield* Editor.Service;
      const editorEvents = yield* EditorEvents.Service;
      const packages = yield* Packages.Service;
      const persistence = yield* Persistence.Service;
      const presence = yield* Presence.Registry;
      yield* persistence.loadProject().pipe(
        Effect.catchTag("ProjectNotFoundError", () => persistence.saveProject(Project.empty())),
        Effect.orDie,
      );
      const runtimeContext = yield* Effect.context<AlchemyRuntimeContext>();
      const storedIdentity = yield* durableState.storage
        .get<{
          readonly projectId?: string;
          readonly publicOrigin?: string;
        }>(editorIdentityKey)
        .pipe(Effect.provide(runtimeContext));
      let activeProjectId = storedIdentity?.projectId;
      let activeSessionId: string | undefined;
      let publicOrigin = storedIdentity?.publicOrigin ?? "http://localhost:1337";
      let persistedIdentity = storedIdentity;
      let reconciledEditorIngress:
        | {
            readonly projectId: string;
            readonly publicOrigin: string;
            readonly engines: string;
            readonly endpoints: ReadonlyArray<HttpEndpoint.Routed>;
          }
        | undefined;

      const credentialSubscribers = new Set<() => Effect.Effect<void>>();
      const credentialsChanged = () =>
        Effect.forEach(credentialSubscribers, (subscriber) => subscriber(), { discard: true });
      const receiveCredential = (credential: CredentialTransfer): Engine.Credential => ({
        id: credential.id,
        provider: credential.provider,
        ...(credential.displayName === undefined ? {} : { displayName: credential.displayName }),
        ...(credential.clientId === undefined ? {} : { clientId: credential.clientId }),
        token: { access: Redacted.make(credential.token.access) },
      });
      const credentials = {
        get: Effect.suspend(() =>
          activeSessionId === undefined
            ? Effect.succeed([])
            : cloudAuths
                .getByName(activeSessionId)
                .getCredentials()
                .pipe(Effect.map((values) => values.map(receiveCredential))),
        ),
        refresh: (provider: string, id: string) =>
          activeSessionId === undefined
            ? Effect.die("MacroGraph Cloud is not connected")
            : cloudAuths
                .getByName(activeSessionId)
                .refreshCredential(provider, id)
                .pipe(
                  Effect.map(receiveCredential),
                  Effect.tap(() => credentialsChanged()),
                ),
        subscribe: (callback: () => Effect.Effect<void>) =>
          Effect.gen(function* () {
            const scope = yield* Effect.scope;
            credentialSubscribers.add(callback);
            yield* Scope.addFinalizerExit(scope, () =>
              Effect.sync(() => {
                credentialSubscribers.delete(callback);
              }),
            );
          }),
        catalog: Effect.suspend(() =>
          activeSessionId === undefined
            ? Effect.succeed(
                Credential.unavailable("not-connected", "MacroGraph Cloud is not connected."),
              )
            : cloudAuths.getByName(activeSessionId).credentialCatalog(),
        ),
        refetch: Effect.suspend(() =>
          activeSessionId === undefined
            ? Effect.succeed(
                Credential.unavailable("not-connected", "MacroGraph Cloud is not connected."),
              )
            : cloudAuths
                .getByName(activeSessionId)
                .refetchCredentials()
                .pipe(Effect.tap(() => credentialsChanged())),
        ),
      };

      const configureRequest = (request: HttpServerRequest.HttpServerRequest) =>
        Effect.gen(function* () {
          let credentialsSessionChanged = false;
          const url = new URL(request.url, "http://localhost:1337");
          activeProjectId = url.searchParams.get("projectId") ?? activeProjectId;
          const requestUserId = request.headers["x-macrograph-user-id"];
          if (
            requestUserId !== undefined &&
            requestUserId === request.headers["x-macrograph-project-created-by"]
          ) {
            const nextSessionId =
              url.searchParams.get("sessionId") ??
              request.headers["x-macrograph-session-id"] ??
              activeSessionId;
            if (nextSessionId !== activeSessionId) {
              activeSessionId = nextSessionId;
              credentialsSessionChanged = true;
            }
          }
          publicOrigin =
            request.headers["x-macrograph-public-origin"] ??
            url.searchParams.get("publicOrigin") ??
            requestOrigin(request);
          if (
            persistedIdentity?.projectId !== activeProjectId ||
            persistedIdentity?.publicOrigin !== publicOrigin
          ) {
            const identity = {
              ...(activeProjectId === undefined ? {} : { projectId: activeProjectId }),
              publicOrigin,
            };
            yield* durableState.storage
              .put(editorIdentityKey, identity)
              .pipe(Effect.provide(runtimeContext));
            persistedIdentity = identity;
          }
          return credentialsSessionChanged;
        });

      const reconcileEditorIngressRaw = Effect.fnUntraced(function* (
        engines: Readonly<Record<string, unknown>>,
      ) {
        if (activeProjectId === undefined) return [];
        const projectId = activeProjectId;
        const origin = publicOrigin;
        const engineState = JSON.stringify(engines);
        if (
          reconciledEditorIngress?.projectId === projectId &&
          reconciledEditorIngress.publicOrigin === origin &&
          reconciledEditorIngress.engines === engineState
        ) {
          return reconciledEditorIngress.endpoints;
        }
        const endpoints = yield* ingress.previewProject({
          projectId,
          publicOrigin: origin,
          previewId: "editor",
          engines,
        });
        reconciledEditorIngress = {
          projectId,
          publicOrigin: origin,
          engines: engineState,
          endpoints,
        };
        return endpoints;
      });
      const reconcileEditorIngress = (engines: Readonly<Record<string, unknown>>) =>
        reconcileEditorIngressRaw(engines).pipe(Effect.provide(runtimeContext), Effect.orDie);

      const endpointHostLayer = Layer.succeed(
        HttpEndpoint.Host,
        HttpEndpoint.Host.of({
          ensure: (handler, options) =>
            ingress.getEndpoint(activeProjectId ?? "unknown", handler.id, options.instanceKey).pipe(
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
            ingress.getEndpoint(activeProjectId ?? "unknown", handler.id, instanceKey).pipe(
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
            ingress
              .lookupEndpoint(activeProjectId ?? "unknown", endpointId)
              .pipe(Effect.provide(runtimeContext), Effect.map(Option.fromNullishOr)),
          secret: () => Effect.die("Webhook signing secrets are owned by the ingress worker"),
        }),
      );

      const editorTwitchLayer = makeTwitchEngine((context) =>
        Effect.gen(function* () {
          const endpointHost = yield* HttpEndpoint.Host;
          const state = yield* SubscriptionRef.make(
            HashMap.empty<
              AccountId,
              { readonly state: "disconnected" | "connecting" | "connected" }
            >(),
          );
          const endpointFor = (accountId: AccountId) =>
            endpointHost.get(EventSubEndpoint, accountId).pipe(
              Effect.catch(() =>
                Effect.logWarning("Failed to determine EventSub webhook state", {
                  accountId,
                }).pipe(Effect.as(Option.none())),
              ),
            );

          return {
            transport: "webhook" as const,
            state: Effect.gen(function* () {
              let current = yield* SubscriptionRef.get(state);
              for (const accountId of yield* context.getAccountIds) {
                if (HashMap.has(current, accountId)) continue;
                const endpoint = yield* endpointFor(accountId);
                if (Option.isSome(endpoint)) {
                  current = HashMap.set(current, accountId, { state: "connected" });
                }
              }
              return current;
            }),
            connect: Effect.fnUntraced(function* (accountId: AccountId) {
              const endpoint = yield* endpointFor(accountId);
              yield* SubscriptionRef.update(state, (current) =>
                HashMap.set(current, accountId, {
                  state: Option.isSome(endpoint) ? "connected" : "disconnected",
                }),
              );
              yield* context.refresh;
            }),
            disconnect: Effect.fnUntraced(function* (accountId: AccountId) {
              yield* SubscriptionRef.update(state, (current) =>
                HashMap.set(current, accountId, { state: "disconnected" }),
              );
              yield* context.refresh;
            }),
          };
        }),
      ).pipe(Layer.provide(Layer.mergeAll(endpointHostLayer, FetchHttpClient.layer)));
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
        const context = EngineHost.editorContextLayer(deployment, {
          emit: () => Effect.void,
          reconcile: (state) =>
            persistence.loadProject().pipe(
              Effect.flatMap((project) =>
                reconcileEditorIngress({
                  ...project.engines,
                  [deployment.pluginId]: state,
                }),
              ),
              Effect.orDie,
            ),
        });
        return EngineHost.layer(deployment, context);
      };
      const EngineClientHandlersLayer = Layer.mergeAll(
        hostDeployment(KofiDeployment),
        hostDeployment({
          ...TwitchDeployment,
          layer: editorTwitchLayer,
        }),
        EngineHost.layer(
          UtilitiesDeployment,
          EngineHost.editorContextLayer(UtilitiesDeployment, { emit: () => Effect.void }),
        ),
        EngineHost.layer(
          HttpClientDeployment,
          EngineHost.editorContextLayer(HttpClientDeployment, { emit: () => Effect.void }),
        ),
      ).pipe(Layer.provide(Layer.succeed(Engine.Credentials, credentials)));
      const MountPlugins = Layer.effectDiscard(
        Effect.gen(function* () {
          const kofi = yield* KofiEngine;
          const twitch = yield* TwitchEngine;
          const utilities = yield* UtilitiesEngine;
          const httpClient = yield* HttpClientEngine;
          yield* EngineHost.mount(KofiPlugin, KofiDeployment, kofi.client.state);
          yield* EngineHost.mount(TwitchPlugin, TwitchDeployment, twitch.client.state);
          yield* EngineHost.mount(UtilitiesPlugin, UtilitiesDeployment, utilities.client.state);
          yield* EngineHost.mount(HttpClientPlugin, HttpClientDeployment, httpClient.client.state);
        }),
      ).pipe(Layer.provideMerge(EngineClientHandlersLayer));
      const RpcLayer = Layer.mergeAll(
        RpcSerialization.layerJsonRpc(),
        EditorRpc.handlerLayer,
        EditorRpc.connectionMiddlewareLayer,
        MountPlugins,
      ).pipe(
        Layer.provide(Layer.succeed(Engine.Credentials, credentials)),
        Layer.provide(
          Layer.succeed(
            EditorAccess.Policy,
            EditorAccess.Policy.of({
              resolve: (headers, clientId) => {
                const connectionId =
                  headers["x-macrograph-connection-id"] ?? `cloud-http-${clientId}`;
                const role = headers["x-macrograph-role"];
                const projectId = headers["x-macrograph-project-id"];
                if (
                  role === undefined ||
                  (role !== "owner" && role !== "admin" && role !== "member") ||
                  projectId === undefined ||
                  activeProjectId === undefined ||
                  projectId !== activeProjectId
                )
                  return new EditorAccess.Forbidden({ operation: "connect" });
                return Effect.succeed({
                  actor: { type: "CLIENT", id: connectionId },
                  connectionId,
                  displayName: headers["x-macrograph-display-name"] ?? "",
                  projectId,
                  canEdit: canMutateProject(role),
                  canManageCredentials: headers["x-macrograph-can-manage-credentials"] === "true",
                });
              },
            }),
          ),
        ),
      );

      const rpcWs = yield* makeRpcServerHttpEffectWebsocket(WorkspaceRpcs).pipe(
        Effect.provide(RpcLayer),
      );

      const disconnectUser = Effect.fnUntraced(function* (userId: string) {
        for (const socket of yield* durableState.getWebSockets()) {
          const attachment = socket.deserializeAttachment<SocketAttachment>();
          if (attachment?.identity?.userId === userId) {
            yield* socket.close(1008, "Permissions changed");
          }
        }
      });

      const disconnectAll = Effect.fnUntraced(function* () {
        for (const socket of yield* durableState.getWebSockets()) {
          yield* socket.close(1008, "Project access changed");
        }
      });

      const snapshot = Effect.fnUntraced(function* (name: string) {
        yield* persistence.loadProject().pipe(
          Effect.catchTag("ProjectNotFoundError", () =>
            persistence.saveProject({ ...Project.empty(), name }),
          ),
          Effect.orDie,
        );
        const project = yield* persistence.loadProject().pipe(Effect.orDie);
        if (project.name !== name) {
          yield* persistence.saveProject({ ...project, name }).pipe(Effect.orDie);
        }
        return yield* editor.project.rendered().pipe(Effect.orDie);
      });

      const listGraphs = () =>
        editor.project
          .get()
          .pipe(
            Effect.map((project) =>
              Object.values(project.graphs).map((graph) => ({ id: graph.id, name: graph.name })),
            ),
          );

      const createGraph = (input: CreateGraphRequest, userId: string) =>
        editorEvents.withActor(
          Effect.gen(function* () {
            const nodes = input.nodes ?? {};
            const connections = input.connections ?? [];

            for (const connection of connections) {
              if (
                !Object.hasOwn(nodes, connection.outNodeId) ||
                !Object.hasOwn(nodes, connection.inNodeId)
              ) {
                return yield* new Connection.InvalidError({
                  reason: "Connection references a node that is not being created",
                });
              }
            }

            const created = yield* editor.graph.create(
              input.name === undefined ? {} : { name: input.name },
            );

            return yield* Effect.gen(function* () {
              const nodeIds = new Map<string, string>();

              for (const [reference, node] of Object.entries(nodes)) {
                const event = yield* editor.node.create({ graphID: created.graph.id, node });
                nodeIds.set(reference, event.node.id);
              }

              for (const connection of connections) {
                const outNodeId = nodeIds.get(connection.outNodeId);
                const inNodeId = nodeIds.get(connection.inNodeId);
                if (outNodeId === undefined || inNodeId === undefined) {
                  return yield* new Connection.InvalidError({
                    reason: "Connection references a node that is not being created",
                  });
                }

                yield* editor.connection.create({
                  graphID: created.graph.id,
                  connection: { ...connection, outNodeId, inNodeId },
                });
              }

              return yield* persistence.loadGraph(created.graph.id);
            }).pipe(
              Effect.catchCause((cause) =>
                editor.graph
                  .delete({ graphID: created.graph.id })
                  .pipe(Effect.orDie, Effect.andThen(Effect.failCause(cause))),
              ),
            );
          }),
          { type: "CLIENT", id: userId },
        );

      const getGraph = Effect.fnUntraced(function* (graphId: string) {
        const snapshot = yield* editor.project.snapshot();
        const graph = snapshot.project.graphs[graphId];
        if (graph === undefined) return yield* new Graph.NotFoundError({ id: graphId });
        return { graph, nodeIO: snapshot.nodeIO[graphId] ?? {} };
      });

      const deleteGraph = Effect.fnUntraced(function* (
        graphId: string,
        projectId: string,
        userId: string,
      ) {
        yield* persistence.loadGraph(graphId);
        const actor = { type: "CLIENT", id: userId } as const;
        yield* editorEvents.withActor(
          editor.graph.delete({ graphID: graphId }).pipe(
            Effect.tap(() =>
              presence.graphDeleted(graphId).pipe(
                Effect.provideService(EditorAccess.Connection, {
                  actor,
                  connectionId: `api-${userId}`,
                  displayName: userId,
                  projectId,
                  canEdit: true,
                  canManageCredentials: true,
                }),
              ),
            ),
          ),
          actor,
        );
      });

      const getPackages = () => packages.getPackages();

      const listResources = () =>
        editor.project.get().pipe(Effect.map((project) => Object.values(project.constants)));

      const createNode = (graphId: string, node: Node.CreateInput, userId: string) =>
        editorEvents.withActor(editor.node.create({ graphID: graphId, node }), {
          type: "CLIENT",
          id: userId,
        });

      const createConnection = (
        graphId: string,
        connection: Connection.CreateInput,
        userId: string,
      ) =>
        editorEvents.withActor(editor.connection.create({ graphID: graphId, connection }), {
          type: "CLIENT",
          id: userId,
        });

      const fetch = HttpRouter.add(
        "*",
        "/rpc",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const credentialsSessionChanged = yield* configureRequest(request);
          const name = request.headers["x-macrograph-project-name"] ?? "New Project";
          const storedProject = yield* persistence.loadProject().pipe(Effect.orDie);
          const project = storedProject.name === name ? storedProject : { ...storedProject, name };
          if (project !== storedProject) {
            yield* persistence.saveProject(project).pipe(Effect.orDie);
          }
          yield* reconcileEditorIngress(project.engines).pipe(
            Effect.flatMap(editor.engine.setEndpoints),
          );
          if (credentialsSessionChanged) {
            yield* durableState
              .waitUntil(
                credentialsChanged().pipe(
                  Effect.catchCause((cause) =>
                    Effect.logError("Failed to refresh editor credentials", cause),
                  ),
                ),
              )
              .pipe(Effect.provide(runtimeContext));
          }

          if (request.headers.upgrade?.toLowerCase() === "websocket") {
            return yield* rpcWs.httpEffect;
          }

          return HttpServerResponse.empty({ status: 426 });
        }),
      ).pipe(HttpRouter.toHttpEffect);

      return {
        fetch,
        disconnectAll,
        disconnectUser,
        credentialsChanged,
        snapshot,
        listGraphs,
        createGraph,
        getGraph,
        deleteGraph,
        getPackages,
        listResources,
        createNode,
        createConnection,
        ...rpcWs.handlers,
      };
    }).pipe(Effect.provide(AppLayer), Effect.provide(FetchHttpClient.layer));
  }),
) {}

type SocketAttachment = {
  uuid: string;
  identity?: {
    readonly displayName: string;
    readonly projectId: string;
    readonly role: string;
    readonly userId: string;
    readonly canManageCredentials: boolean;
  };
};

const makeRpcServerHttpEffectWebsocket = Effect.fnUntraced(function* <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
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
        readonly close: (code: number, reason: string) => Effect.Effect<void>;
        readonly webSocketMessage: (message: string | ArrayBuffer) => Effect.Effect<void>;
        readonly webSocketClose: (code: number, reason: string) => Effect.Effect<void>;
      }
    >();
    const uuidToId = new Map<string, number>();
    const clientIds = new Set<number>();
    const removeSocket = (uuid: string, id: number) =>
      Effect.gen(function* () {
        if (uuidToId.get(uuid) !== id) return;
        clients.delete(id);
        uuidToId.delete(uuid);
        clientIds.delete(id);
        yield* Queue.offer(disconnects, id);
      });

    const onSocket = Effect.fnUntraced(function* (
      socket: Cloudflare.WebSocket,
      identity?: SocketAttachment["identity"],
    ) {
      const id = clientId++;
      const uuid = crypto.randomUUID();
      socket.serializeAttachment<SocketAttachment>({ uuid, identity });

      const connectionHeaders: ReadonlyArray<[string, string]> = [
        ["x-macrograph-connection-id", uuid],
        ...(identity === undefined
          ? []
          : [
              ["x-macrograph-display-name", identity.displayName] as [string, string],
              ["x-macrograph-project-id", identity.projectId] as [string, string],
              ["x-macrograph-role", identity.role] as [string, string],
              ["x-macrograph-can-manage-credentials", String(identity.canManageCredentials)] as [
                string,
                string,
              ],
            ]),
      ];

      uuidToId.set(uuid, id);

      const parser = serialization.makeUnsafe();

      const writeRaw = socket.send;
      const write = (response: RpcMessage.FromServerEncoded) => {
        try {
          const encoded = parser.encode(response);
          if (encoded === undefined) {
            return Effect.void;
          }
          return Effect.orDie(writeRaw(DualProtocol.frameRpc(encoded)));
        } catch (cause) {
          const encoded = parser.encode(RpcMessage.ResponseDefectEncoded(cause));
          if (encoded === undefined) return Effect.void;
          return Effect.orDie(writeRaw(DualProtocol.frameRpc(encoded)));
        }
      };
      clients.set(id, {
        write,
        close: (code, reason) =>
          socket.close(code, reason).pipe(Effect.ensuring(removeSocket(uuid, id))),
        webSocketClose: () => removeSocket(uuid, id),
        webSocketMessage: (data) => {
          if (typeof data === "string") return Effect.void;
          const bytes = new Uint8Array(data);
          if (bytes.byteLength === 0 || bytes[0] !== DualProtocol.rpcFrameTag) return Effect.void;

          try {
            const decoded = parser.decode(
              bytes.subarray(1),
            ) as ReadonlyArray<RpcMessage.FromClientEncoded>;
            if (decoded.length === 0) return Effect.void;
            let i = 0;
            return Effect.whileLoop({
              while: () => i < decoded.length,
              body() {
                const message = decoded[i++];
                return writeRequest(
                  id,
                  message._tag === "Request"
                    ? {
                        ...message,
                        headers: message.headers
                          .filter(([name]) => !name.toLowerCase().startsWith("x-macrograph-"))
                          .concat(connectionHeaders),
                      }
                    : message,
                );
              },
              step: constVoid,
            });
          } catch (cause) {
            const encoded = parser.encode(RpcMessage.ResponseDefectEncoded(cause));
            if (encoded === undefined) return Effect.void;
            return writeRaw(DualProtocol.frameRpc(encoded));
          }
        },
      });
      clientIds.add(id);
    });

    for (const socket of yield* state.getWebSockets()) {
      yield* socket.close(1012, "Editor restarted");
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
          return client
            .write(response)
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logError("Editor WebSocket send failed", cause).pipe(
                  Effect.andThen(client.close(1011, "Send failed")),
                ),
              ),
            );
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

          return client.webSocketMessage(message).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("Editor WebSocket message failed", cause).pipe(
                Effect.andThen(client.close(1003, "Invalid message")),
              ),
            ),
            Effect.as(true),
          );
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
    const request = yield* HttpServerRequest.HttpServerRequest;
    const [response, socket] = yield* Cloudflare.upgrade();

    const displayName = request.headers["x-macrograph-display-name"];
    const projectId = request.headers["x-macrograph-project-id"];
    const role = request.headers["x-macrograph-role"];
    const userId = request.headers["x-macrograph-user-id"];
    const projectCreatedBy = request.headers["x-macrograph-project-created-by"];
    yield* onSocket(
      socket,
      displayName === undefined ||
        projectId === undefined ||
        role === undefined ||
        userId === undefined
        ? undefined
        : {
            displayName,
            projectId,
            role,
            userId,
            canManageCredentials:
              projectCreatedBy === userId && (role === "owner" || role === "admin"),
          },
    );

    return response;
  });

  yield* RpcServer.make(group).pipe(
    Effect.provideService(RpcServer.Protocol, protocol),
    Effect.forkDetach,
  );

  return { httpEffect, handlers };
});
