import type * as S from "effect/Schema";

import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Drizzle from "@alchemy.run/drizzle";
import { Actor, Connection, Graph, Node, Package, Project } from "@macrograph/core";
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
import { Credential, Engine, HttpEndpoint } from "@macrograph/module";
import { ModuleRegistry } from "@macrograph/module-host/core";
import { RequestFailure as OpenCodeFailure } from "@macrograph/module-opencode/Definition";
import { ModuleAdminRpc } from "@macrograph/module/ModuleAdminRpc";
import { Persistence } from "@macrograph/persistence";
import { SqlitePersistence } from "@macrograph/persistence-sqlite";
import { ProjectEditor } from "@macrograph/project-api";
import { RuntimeContext as AlchemyRuntimeContext } from "alchemy";
import {
  Cause,
  Context,
  Duration,
  Layer,
  Option,
  Queue,
  Redacted,
  Schema,
  Scope,
  Stream,
} from "effect";
import * as Effect from "effect/Effect";
import { constVoid } from "effect/Function";
import { FetchHttpClient, HttpServerRequest, HttpServerResponse } from "effect/http";
import { Rpc, RpcGroup, RpcMessage, RpcSerialization, RpcServer } from "effect/rpc";

import type * as CloudWorkerOperations from "../worker/CloudWorkerOperations.ts";

import { requestOrigin } from "../api/HttpOrigin.ts";
import CloudAuthDO, { type CredentialTransfer } from "../auth/CloudAuthDO.ts";
import * as CloudModules from "../modules/CloudModules.ts";
import * as OpenCodeInstances from "../opencode/OpenCodeInstances.ts";
import { canMutateProject } from "../team/TeamAccess.ts";
import { DurableObjectMigrationBundle } from "./DurableObjectMigrationBundle.ts";
import { DurableSqlitePersistence } from "./DurableSqlitePersistence.ts";
import { ModuleRpcRoutes } from "./ModuleRpcRoutes.ts";

const sqliteSchemaPath = "../../packages/persistence-sqlite/src/schema.ts";
/** Module RPCs are served per module over HTTP (`ModuleRpcRoutes`), not on this socket. */
const CatalogRpcs = RpcGroup.make(ModuleAdminRpc.GetModules);
const WorkspaceRpcs = EditorServer.mergeRpcGroups(EditorRpc.EditorRpcs, CatalogRpcs).middleware(
  EditorRpc.ConnectionMiddleware,
);
const editorIdentityKey = "editor-identity";

/** Named here so the Durable Object's inferred RPC type can refer to the editor's errors. */
export type ProjectEditorError =
  | Connection.InvalidError
  | Graph.NotFoundError
  | Node.NotFoundError
  | Package.SchemaNotFoundError
  | Package.InvalidPropertyError
  | Package.InvalidInputDefaultError;
const editorCredentialsKey = "editor-credentials";

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
    // Managed OpenCode instances are hosted by the production worker (CloudWorker binds its
    // namespace); the editor uses them directly instead of provisioning preview instances.
    const openCodeDos = OpenCodeInstances.bindNamespace(workerEnvironment?.OpenCodeDO);
    let activeProjectId: string | undefined;
    const openCodeInstances = OpenCodeInstances.make(
      Effect.suspend(() =>
        activeProjectId === undefined
          ? Effect.fail(new OpenCodeFailure({ reason: "Project identity is unavailable" }))
          : Effect.succeed(activeProjectId),
      ),
      openCodeDos,
      "editor",
    );

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
      const persistence = yield* Persistence.Service;
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
      activeProjectId = storedIdentity?.projectId;
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
      let localCredentials = yield* durableState.storage
        .get<ReadonlyArray<CredentialTransfer>>(editorCredentialsKey)
        .pipe(Effect.provide(runtimeContext));
      const setCredentials = (values: ReadonlyArray<CredentialTransfer>) =>
        durableState.storage.put(editorCredentialsKey, values).pipe(
          Effect.provide(runtimeContext),
          Effect.tap(() =>
            Effect.sync(() => {
              localCredentials = values;
            }),
          ),
          Effect.andThen(credentialsChanged()),
        );
      const receiveCredential = (credential: CredentialTransfer): Engine.Credential => ({
        id: credential.id,
        provider: credential.provider,
        ...(credential.displayName === undefined ? {} : { displayName: credential.displayName }),
        ...(credential.clientId === undefined ? {} : { clientId: credential.clientId }),
        token: { access: Redacted.make(credential.token.access) },
      });
      const credentials = {
        get: Effect.suspend(() =>
          localCredentials !== undefined
            ? Effect.succeed(localCredentials.map(receiveCredential))
            : activeSessionId === undefined
              ? Effect.succeed([])
              : cloudAuths
                  .getByName(activeSessionId)
                  .getCredentials()
                  .pipe(Effect.map((values) => values.map(receiveCredential))),
        ),
        refresh: (provider: string, id: string) =>
          localCredentials !== undefined
            ? (() => {
                const credential = localCredentials.find(
                  (candidate) => candidate.provider === provider && candidate.id === id,
                );
                return credential === undefined
                  ? Effect.die("Credential is unavailable")
                  : Effect.succeed(receiveCredential(credential));
              })()
            : activeSessionId === undefined
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
        remount: boolean,
      ) {
        if (activeProjectId === undefined) return [];
        const projectId = activeProjectId;
        const origin = publicOrigin;
        const engineState = JSON.stringify(engines);
        if (
          !remount &&
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
          remount,
        });
        reconciledEditorIngress = {
          projectId,
          publicOrigin: origin,
          engines: engineState,
          endpoints,
        };
        return endpoints;
      });
      const reconcileEditorIngress = (
        engines: Readonly<Record<string, unknown>>,
        remount = false,
      ) =>
        reconcileEditorIngressRaw(engines, remount).pipe(
          Effect.provide(runtimeContext),
          Effect.orDie,
        );

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
          secret: (endpointId) =>
            ingress
              .endpointSecret(activeProjectId ?? "unknown", endpointId)
              .pipe(Effect.provide(runtimeContext), Effect.map(Redacted.make)),
        }),
      );

      const moduleHost: CloudModules.EditorHost = {
        credentials,
        endpointHost: endpointHostLayer,
        reconcile: (moduleId, state) =>
          persistence.loadProject().pipe(
            Effect.flatMap((project) =>
              reconcileEditorIngress({ ...project.engines, [moduleId]: state }),
            ),
            Effect.orDie,
          ),
        reconnectIngress: persistence.loadProject().pipe(
          Effect.orDie,
          Effect.flatMap((project) => reconcileEditorIngress(project.engines, true)),
          Effect.flatMap(editor.engine.setEndpoints),
        ),
        openCode: openCodeInstances,
      };
      const CatalogHandlers = CatalogRpcs.toLayer(
        Effect.map(ModuleRegistry.Service, (registry) => ({
          GetModules: () => registry.catalog,
        })),
      );
      // The cloud's modules are static, but the editor refetches the catalog whenever it changes.
      const ModulesChanged = Layer.effectDiscard(
        Effect.gen(function* () {
          const registry = yield* ModuleRegistry.Service;
          const events = yield* EditorEvents.Service;
          const entries = yield* registry.entries;
          yield* registry.changes.pipe(
            Stream.filter((value) => value !== entries),
            Stream.debounce(Duration.millis(50)),
            Stream.runForEach(() => events.publishEphemeral({ _tag: "ModulesChanged" })),
            Effect.forkScoped,
          );
        }),
      );
      const RpcLayer = Layer.mergeAll(
        RpcSerialization.layerJsonRpc(),
        EditorRpc.handlerLayer,
        EditorRpc.connectionMiddlewareLayer,
        CatalogHandlers,
        ModulesChanged,
      ).pipe(
        Layer.provideMerge(CloudModules.registryLayer(moduleHost)),
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
                const userId = headers["x-macrograph-user-id"];
                const email = headers["x-macrograph-email"];
                if (
                  role === undefined ||
                  userId === undefined ||
                  (role !== "owner" && role !== "member" && role !== "viewer") ||
                  projectId === undefined ||
                  activeProjectId === undefined ||
                  projectId !== activeProjectId
                )
                  return new EditorAccess.Forbidden({ operation: "connect" });
                return Effect.succeed({
                  actor: Actor.client("browser", connectionId, userId),
                  displayName: headers["x-macrograph-display-name"] ?? "",
                  email: email === undefined || email.length === 0 ? null : email,
                  projectId,
                  canEdit: canMutateProject(role),
                  canManageCredentials: headers["x-macrograph-can-manage-credentials"] === "true",
                });
              },
            }),
          ),
        ),
      );

      // Engines fork in-process runtime RPC servers, so the layer must outlive construction.
      const rpcContext = yield* Layer.buildWithScope(RpcLayer, Scope.makeUnsafe());
      const modules = Context.get(rpcContext, ModuleRegistry.Service);
      const rpcWs = yield* makeRpcServerHttpEffectWebsocket(WorkspaceRpcs).pipe(
        Effect.provide(rpcContext),
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

      const getProject = Effect.fnUntraced(function* (name: string) {
        yield* persistence.loadProject().pipe(
          Effect.catchTag("ProjectNotFoundError", () =>
            persistence.saveProject({ ...Project.empty(), name }),
          ),
          Effect.orDie,
        );
        const project = yield* persistence.loadProject().pipe(Effect.orDie);
        if (project.name !== name) {
          yield* persistence.saveProject({ ...project, name }).pipe(Effect.orDie);
          return { ...project, name };
        }
        return project;
      });

      const getRenderedProject = Effect.fnUntraced(function* (name: string) {
        yield* getProject(name);
        return yield* editor.project.rendered().pipe(Effect.orDie);
      });

      // An interrupt-only cause reaches MCP/REST callers as an opaque "unexpected cause", so
      // surface it as a defect naming the operation.
      const projectEditor = Object.fromEntries(
        Object.entries(yield* ProjectEditor.make).map(([name, operation]) => [
          name,
          (...args: ReadonlyArray<unknown>) =>
            (operation as (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown>)(
              ...args,
            ).pipe(
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.die(new Error(`${name} was interrupted: ${Cause.pretty(cause)}`))
                  : Effect.failCause(cause),
              ),
            ),
        ]),
      ) as unknown as ProjectEditor.Operations;

      const fetch = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const credentialsSessionChanged = yield* configureRequest(request);
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
        // Module RPCs skip project and ingress reconciliation, which every connection repeats.
        if (ModuleRpcRoutes.isModulePath(request.url))
          return yield* ModuleRpcRoutes.serve(modules, { projectId: activeProjectId });
        const name = request.headers["x-macrograph-project-name"] ?? "New Project";
        const storedProject = yield* persistence.loadProject().pipe(Effect.orDie);
        const project = storedProject.name === name ? storedProject : { ...storedProject, name };
        if (project !== storedProject) {
          yield* persistence.saveProject(project).pipe(Effect.orDie);
        }
        yield* reconcileEditorIngress(project.engines).pipe(
          Effect.flatMap(editor.engine.setEndpoints),
          // A provider failure must not prevent opening the editor to repair its settings.
          Effect.catchCause((cause) =>
            Effect.logError("Failed to reconcile editor ingress", cause),
          ),
        );

        if (request.headers.upgrade?.toLowerCase() === "websocket") {
          return yield* rpcWs.httpEffect;
        }

        return HttpServerResponse.empty({ status: 426 });
      });

      return {
        fetch,
        disconnectAll,
        disconnectUser,
        credentialsChanged,
        setCredentials,
        getProject,
        getRenderedProject,
        ...projectEditor,
        ...rpcWs.handlers,
      };
    }).pipe(
      // Effect.provide would close the layer's scope once construction finishes, shutting down
      // services such as the presence registry for every later request.
      Effect.provide(Layer.effectContext(Layer.buildWithScope(AppLayer, Scope.makeUnsafe()))),
      Effect.provide(FetchHttpClient.layer),
    );
  }),
) {}

type SocketAttachment = {
  uuid: string;
  identity?: {
    readonly displayName: string;
    readonly email: string;
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
              ["x-macrograph-email", identity.email] as [string, string],
              ["x-macrograph-user-id", identity.userId] as [string, string],
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
        supportsAck: true,
        supportsNotifications: true,
        supportsTransferables: false,
        supportsSpanPropagation: true,
        codecFor: serialization.codecFor,
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
    const email = request.headers["x-macrograph-email"] ?? "";
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
            email,
            projectId,
            role,
            userId,
            canManageCredentials:
              projectCreatedBy === userId && (role === "owner" || role === "member"),
          },
    );

    return response;
  });

  // A failed provider setup must not terminate unrelated requests or the project event stream.
  yield* RpcServer.make(group, { disableFatalDefects: true }).pipe(
    Effect.provideService(RpcServer.Protocol, protocol),
    Effect.forkDetach,
  );

  return { httpEffect, handlers };
});
