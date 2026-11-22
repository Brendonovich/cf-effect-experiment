import type { Socket } from "node:net";

import { NodeHttpServer, NodeServices, NodeSocket } from "@effect/platform-node";
import { CloudCredentials, SessionStoreError } from "@macrograph/cloud-credentials";
import { Project } from "@macrograph/core";
import {
  Editor,
  EditorAccess,
  EditorEvents,
  EditorRpc,
  EditorServer,
  Packages,
  Presence,
  QueueRuntime,
} from "@macrograph/editor";
import { RuntimeActivity } from "@macrograph/execution";
import { LiveRuntime } from "@macrograph/live-runtime";
import { Credential, Engine } from "@macrograph/module";
import { DrizzleDriver, SqlitePersistence } from "@macrograph/persistence-sqlite";
import { Effect, Layer, type Scope } from "effect";
import {
  FetchHttpClient,
  HttpMiddleware,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { mkdirSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import Deployments from "virtual:macrograph-module-deployments";

import { ApiKeys } from "./ApiKeys.ts";
import { makeAtomicFileStore } from "./AtomicFileStore.ts";
import { ClientSessions } from "./ClientSessions.ts";
import { LocalAccess } from "./LocalAccess.ts";
import { ModuleHost } from "./ModuleHost.ts";
import { Observability } from "./Observability.ts";
import { ProjectApi } from "./ProjectApi.ts";
import { ServerConfig } from "./ServerConfig.ts";
import { ServerSetup } from "./ServerSetup.ts";
import { StaticRoutes } from "./StaticRoutes.ts";
import { version } from "./Version.ts";

export interface Options {
  readonly config: ServerConfig.Config;
  /** Grants owner access to requests bearing the background service's local token. */
  readonly local: LocalAccess.Access;
  /** Writes the machine-readable `MACROGRAPH_SETUP_KEY` and `MACROGRAPH_LISTENING` lines. */
  readonly announce: (line: string) => void;
  /** Runs once the server is listening, before the app is built; its scope lasts until shutdown. */
  readonly onListen?: (port: number) => Effect.Effect<void, never, Scope.Scope>;
}

const makeCloudCredentials = (config: ServerConfig.Config) => {
  const authFile = makeAtomicFileStore(config.cloudAuthPath);
  return CloudCredentials.make({
    issuer: config.issuer,
    client: { type: "registered", name: config.serverName, softwareId: "macrograph-server" },
    store: {
      read: authFile.read.pipe(
        Effect.mapError((error) => new SessionStoreError({ reason: error.reason })),
      ),
      write: (value) =>
        authFile
          .write(value)
          .pipe(Effect.mapError((error) => new SessionStoreError({ reason: error.reason }))),
      clear: authFile.clear.pipe(
        Effect.mapError((error) => new SessionStoreError({ reason: error.reason })),
      ),
    },
  }).pipe(Effect.provide(FetchHttpClient.layer));
};

interface Deps {
  readonly config: ServerConfig.Config;
  readonly local: LocalAccess.Access;
  readonly cloudCredentials: Effect.Success<ReturnType<typeof makeCloudCredentials>>;
  readonly clientSessions: ClientSessions;
  readonly setup: ReturnType<typeof ServerSetup.make>;
}

const bearerFrom = (request: HttpServerRequest.HttpServerRequest) =>
  LocalAccess.bearer(request.headers.authorization);

const WorkspaceRpcs = EditorServer.mergeRpcGroups(
  EditorRpc.EditorRpcs,
  RuntimeActivity.Rpcs,
  ...Deployments.flatMap((deployment) =>
    "definition" in deployment ? [deployment.definition.ClientRpcs] : [],
  ),
).middleware(EditorRpc.ConnectionMiddleware);

// Fresh, because layers are memoized by reference and each transport needs its own policy.
const connectionMiddlewareFor = (
  { config, local, clientSessions, setup }: Deps,
  transport: ClientSessions.Transport,
) =>
  Layer.fresh(EditorRpc.connectionMiddlewareLayer).pipe(
    Layer.provideMerge(
      Layer.succeed(
        EditorAccess.Policy,
        clientSessions.policy(setup.ownerId, config.adminIds, transport, local),
      ),
    ),
  );

const canEditRequest =
  ({ config, local, clientSessions, setup }: Deps) =>
  (request: HttpServerRequest.HttpServerRequest) =>
    Effect.gen(function* () {
      const token = bearerFrom(request);
      if (local.matches(token)) return true;
      const [session, ownerId] = yield* Effect.all([clientSessions.resolve(token), setup.ownerId]);
      return (
        session !== undefined && (session.userId === ownerId || config.adminIds.has(session.userId))
      );
    });

const editorHttpRoutes = (deps: Deps) => {
  const { config } = deps;
  const WsEndpoints = Layer.effectDiscard(
    Effect.gen(function* () {
      const { httpEffect } = yield* EditorServer.toDualHttpEffectWebsocket(
        WorkspaceRpcs,
        undefined,
        (request) => {
          const session = new URL(request.url, config.publicOrigin).searchParams.get("session");
          return [
            ...Object.entries(request.headers),
            ...(session === null ? [] : [["x-macrograph-session", session] as [string, string]]),
          ];
        },
      );
      yield* (yield* HttpRouter.HttpRouter)
        .prefixed(config.basePath)
        .add("*", "/rpc-ws", httpEffect);
    }),
  ).pipe(Layer.provide(connectionMiddlewareFor(deps, "ws")));

  const EditorHttpRpc = Layer.effectDiscard(
    Effect.gen(function* () {
      const httpEffect = yield* RpcServer.toHttpEffect(EditorRpc.EditorRpcs);
      yield* (yield* HttpRouter.HttpRouter).prefixed(config.basePath).add("*", "/rpc", httpEffect);
    }),
  );

  return Layer.merge(EditorHttpRpc, WsEndpoints);
};

/**
 * Identifies the background service to its local clients. Only local-token holders may read it,
 * so it can include the setup link that would otherwise only be printed to the service's stderr.
 */
const infoRoute = ({ config, local, setup }: Deps) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const router = (yield* HttpRouter.HttpRouter).prefixed(config.basePath);
      yield* router.add(
        "GET",
        "/api/info",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          if (!local.matches(bearerFrom(request))) return HttpServerResponse.empty({ status: 401 });
          const key = yield* setup.setupKey;
          return HttpServerResponse.jsonUnsafe(
            {
              version,
              pid: process.pid,
              setupUrl: key === undefined ? null : setupUrl(config, key),
            },
            { headers: { "cache-control": "no-store" } },
          );
        }),
      );
    }),
  );

// The key goes in the fragment so it is never sent to the server or stored in access logs.
const setupUrl = (config: ServerConfig.Config, key: string) =>
  `${config.publicOrigin}${config.basePath}/#setup-key=${encodeURIComponent(key)}`;

const clientAuthRoutes = ({ config, cloudCredentials, clientSessions, setup }: Deps) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const router = (yield* HttpRouter.HttpRouter).prefixed(config.basePath);
      const tokenFrom = (request: HttpServerRequest.HttpServerRequest) => {
        const authorization = request.headers.authorization;
        return authorization?.startsWith("Bearer ")
          ? authorization.slice("Bearer ".length)
          : undefined;
      };
      const responseFor = Effect.fnUntraced(function* (token: string | undefined) {
        const [session, { ownerId, setupRequired }] = yield* Effect.all([
          clientSessions.resolve(token),
          setup.status,
        ]);
        return {
          user: session ?? null,
          setupRequired,
          hasOwner: ownerId !== undefined,
          canEdit:
            session !== undefined &&
            (session.userId === ownerId || config.adminIds.has(session.userId)),
        };
      });

      yield* router.add(
        "GET",
        "/auth/session",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          return HttpServerResponse.jsonUnsafe(yield* responseFor(tokenFrom(request)), {
            headers: { "cache-control": "no-store" },
          });
        }),
      );
      for (const operation of ["start", "poll"] as const) {
        yield* router.add(
          "POST",
          `/auth/setup/${operation}`,
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const body = yield* request.json.pipe(Effect.catch(() => Effect.succeed(undefined)));
            if (
              typeof body !== "object" ||
              body === null ||
              !("key" in body) ||
              typeof body.key !== "string"
            )
              return HttpServerResponse.jsonUnsafe({ error: "Invalid request" }, { status: 400 });
            return HttpServerResponse.jsonUnsafe(yield* setup[operation](body.key), {
              headers: { "cache-control": "no-store" },
            });
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed(
                HttpServerResponse.jsonUnsafe(
                  { error: error.reason },
                  {
                    status: error._tag === "SetupError" ? 403 : 400,
                    headers: { "cache-control": "no-store" },
                  },
                ),
              ),
            ),
          ),
        );
      }
      yield* router.add(
        "POST",
        "/auth/start",
        cloudCredentials.signIn.start.pipe(
          Effect.map((authorization) =>
            HttpServerResponse.jsonUnsafe(
              {
                deviceCode: authorization.deviceCode,
                userCode: authorization.userCode,
                verificationUrl: authorization.verificationUrl,
                interval: authorization.interval,
              },
              { headers: { "cache-control": "no-store" } },
            ),
          ),
          Effect.catch((error) =>
            Effect.succeed(
              HttpServerResponse.jsonUnsafe(
                { error: error.reason, code: error.code },
                { status: 502, headers: { "cache-control": "no-store" } },
              ),
            ),
          ),
        ),
      );
      yield* router.add(
        "POST",
        "/auth/poll",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const body = yield* request.json.pipe(Effect.catch(() => Effect.succeed(undefined)));
          if (
            typeof body !== "object" ||
            body === null ||
            !("deviceCode" in body) ||
            typeof body.deviceCode !== "string"
          )
            return HttpServerResponse.jsonUnsafe({ error: "Invalid request" }, { status: 400 });
          const result = yield* cloudCredentials.signIn
            .poll(body.deviceCode)
            .pipe(Effect.mapError((error) => error.reason));
          if (result.state === "pending")
            return HttpServerResponse.jsonUnsafe(result, {
              headers: { "cache-control": "no-store" },
            });
          const token = yield* clientSessions.create({
            userId: result.userId,
            email: result.email,
          });
          return HttpServerResponse.jsonUnsafe(
            { state: result.state, userId: result.userId, email: result.email, token },
            {
              headers: { "cache-control": "no-store" },
            },
          );
        }).pipe(
          Effect.catch((reason) =>
            Effect.succeed(HttpServerResponse.jsonUnsafe({ error: reason }, { status: 400 })),
          ),
        ),
      );
      yield* router.add(
        "DELETE",
        "/auth/session",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const token = tokenFrom(request);
          if (token !== undefined) yield* clientSessions.remove(token);
          return HttpServerResponse.empty({ status: 204 });
        }),
      );
    }),
  );

const EditorLayer = Editor.layer.pipe(
  Layer.provideMerge(EditorEvents.layer),
  Layer.provideMerge(Packages.defaultLayer),
  Layer.provideMerge(Presence.layer),
);

const LiveRuntimeLayer = LiveRuntime.layer({
  initialProject: { ...Project.empty(), name: "test" },
}).pipe(Layer.provideMerge(EditorLayer));

const healthRoute = (basePath: string) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const router = (yield* HttpRouter.HttpRouter).prefixed(basePath);
      const liveness = HttpServerResponse.jsonUnsafe(
        { status: "ok" },
        { headers: { "cache-control": "no-store" } },
      );
      const readiness = HttpServerResponse.jsonUnsafe(
        {
          status: "ok",
          ready: true,
          checks: { http: "up", persistence: "ready" },
        },
        { headers: { "cache-control": "no-store" } },
      );
      yield* router.add("GET", "/health/live", liveness);
      yield* router.add("GET", "/health/ready", readiness);
      yield* router.add("GET", "/health", readiness);
    }),
  );

const pathGuard = HttpMiddleware.make((httpEffect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return StaticRoutes.isUnsafePath(request.originalUrl)
      ? HttpServerResponse.text("Invalid path", { status: 400 })
      : yield* httpEffect;
  }),
);

/**
 * Answers requests that arrive after the server is bound but before the app is serving them, so
 * clients can tell a booting server from a dead one. It steps aside once the app's handler is
 * attached.
 */
const bootingResponder =
  (
    server: ReturnType<typeof createServer>,
    config: ServerConfig.Config,
    local: LocalAccess.Access,
  ) =>
  (request: IncomingMessage, response: ServerResponse) => {
    if (server.listenerCount("request") > 1) return;
    const json = (status: number, body: unknown) => {
      response.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(body));
    };
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path !== `${config.basePath}/api/info`) return json(503, { error: "Starting" });
    if (!local.matches(LocalAccess.bearer(request.headers.authorization)))
      return response.writeHead(401).end();
    json(503, { version, pid: process.pid, setupUrl: null });
  };

/**
 * The self-hosted server. Building it creates the data directory, binds the port, and then builds
 * and serves the app; nothing happens until the layer is built.
 */
export const layer = (options: Options) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const { config, local } = options;
      yield* Effect.sync(() => mkdirSync(config.dataDirectory, { recursive: true }));
      const cloudCredentials = yield* makeCloudCredentials(config);
      const clientSessions = ClientSessions.make(makeAtomicFileStore(config.clientAuthPath));
      const setup = ServerSetup.make({
        store: makeAtomicFileStore(config.ownerPath),
        auth: cloudCredentials.auth,
        sessions: clientSessions,
        onKeyIssued: (key) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => options.announce(`MACROGRAPH_SETUP_KEY ${key}`));
            yield* Effect.logInfo(`Open ${setupUrl(config, key)} to set up this server.`);
          }),
      });
      const deps: Deps = { config, local, cloudCredentials, clientSessions, setup };
      const serverOwnerId = setup.ownerId;

      const RemoteApiRoutes = ProjectApi.layer({
        basePath: config.basePath,
        apiKeys: ApiKeys.make(makeAtomicFileStore(config.apiKeysPath)),
        sessions: clientSessions,
        local,
        ownerId: serverOwnerId,
        adminIds: config.adminIds,
        projectTimestamps: Effect.sync(() => {
          const stats = statSync(config.databasePath, { throwIfNoEntry: false });
          const now = new Date().toISOString();
          return {
            createdAt: stats?.birthtime.toISOString() ?? now,
            updatedAt: stats?.mtime.toISOString() ?? now,
          };
        }),
      });

      const ApiRoutes = Layer.mergeAll(
        editorHttpRoutes(deps),
        clientAuthRoutes(deps),
        RemoteApiRoutes,
        ModuleHost.rpcRoute(config.basePath, canEditRequest(deps)),
        healthRoute(config.basePath),
        local.enabled ? infoRoute(deps) : Layer.empty,
      );

      const StaticRoute = StaticRoutes.layer({
        root: config.assetsDirectory,
        basePath: config.basePath,
        publicOrigin: config.publicOrigin,
        ...(config.browserOtlpEndpoint === undefined
          ? {}
          : { otlpEndpoint: config.browserOtlpEndpoint }),
      });

      const HttpRoutes = ApiRoutes.pipe(Layer.provideMerge(StaticRoute));

      const MountedModules = Layer.mergeAll(
        Layer.empty,
        ...Deployments.map((deployment) =>
          "definition" in deployment
            ? ModuleHost.deploymentLayer(deployment)
            : ModuleHost.moduleLayer(deployment),
        ),
      );

      const AppLayer = HttpRoutes.pipe(
        Layer.provideMerge(MountedModules),
        Layer.provide(EditorRpc.handlerLayer),
        Layer.provide(RuntimeActivity.handlerLayer),
        // HTTP RPC servers (editor and module routes) share this; the WebSocket server has its own.
        Layer.provide(connectionMiddlewareFor(deps, "http")),
        Layer.provide(RpcSerialization.layerJsonRpc()),
        Layer.provide(LiveRuntimeLayer),
        Layer.provide(RuntimeActivity.layer),
        Layer.provide(QueueRuntime.layer),
        Layer.provide(
          Layer.succeed(Engine.Credentials, {
            ...cloudCredentials.credentials,
            auth: {
              ...cloudCredentials.auth,
              // The setup approval URL is a capability, not public credential status.
              status: serverOwnerId.pipe(
                Effect.flatMap((ownerId) =>
                  ownerId === undefined
                    ? Effect.succeed({ state: "disconnected" as const })
                    : cloudCredentials.auth.status,
                ),
              ),
              // Only the owner's account may connect the server, even when started from settings.
              poll: serverOwnerId.pipe(
                Effect.flatMap((ownerId) =>
                  ownerId === undefined
                    ? Effect.fail(
                        new Credential.AuthError({
                          reason: "Set up this server before connecting it",
                        }),
                      )
                    : cloudCredentials.pollOwner(ownerId),
                ),
              ),
            },
          }),
        ),
        Layer.provide(ModuleHost.layer),
        Layer.provide(SqlitePersistence.layer),
        Layer.provide(
          Layer.mergeAll(
            DrizzleDriver.layerNodeSqlite(config.databasePath, config.migrationsDirectory),
            NodeServices.layer,
          ),
        ),
        // Issues and logs a setup key while the server is unclaimed.
        Layer.provide(
          Layer.effectDiscard(
            Effect.gen(function* () {
              const scope = yield* Effect.scope;
              yield* setup.status;
              // Forked because notifications can arrive while setup holds its lock.
              yield* cloudCredentials.credentials.subscribe(() =>
                setup.status.pipe(Effect.forkIn(scope), Effect.asVoid),
              );
            }),
          ),
        ),
      );

      const nodeServer = createServer();
      const sockets = new Set<Socket>();
      nodeServer.on("request", bootingResponder(nodeServer, config, local));
      nodeServer.on("connection", (socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
      });
      nodeServer.on("listening", () => {
        if (config.behindDevProxy) return;
        const address = nodeServer.address();
        if (typeof address === "object" && address !== null)
          options.announce(`MACROGRAPH_LISTENING ${address.port}`);
      });

      const ShutdownLayer = Layer.effectDiscard(
        Effect.gen(function* () {
          let shuttingDown = false;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (shuttingDown) return;
              shuttingDown = true;
              nodeServer.closeAllConnections();
              for (const socket of sockets) socket.end();
              const timeout = setTimeout(() => {
                for (const socket of sockets) socket.destroy();
              }, 5_000);
              timeout.unref();
            }),
          );
        }),
      );

      const { onListen } = options;
      // Built after the HTTP server is listening and before the app it provides.
      const Listening =
        onListen === undefined
          ? Layer.empty
          : Layer.effectDiscard(
              Effect.suspend(() => {
                const address = nodeServer.address();
                return typeof address === "object" && address !== null
                  ? onListen(address.port)
                  : Effect.die("The HTTP server has no port");
              }),
            );

      const Served = HttpRouter.serve(AppLayer, {
        disableLogger: true,
        disableListenLog: config.behindDevProxy,
        middleware: pathGuard,
      }).pipe(
        Layer.provide(
          Listening.pipe(
            Layer.provideMerge(
              NodeHttpServer.layer(() => nodeServer, {
                port: config.port,
                host: config.host,
                gracefulShutdownTimeout: "10 seconds",
              }),
            ),
          ),
        ),
        Layer.provide(Observability.layer(config)),
        Layer.provide(Layer.mergeAll(FetchHttpClient.layer, NodeSocket.layerWebSocketConstructor)),
      );

      // This outer layer is acquired last, so it quiesces sockets before the HTTP server waits to close.
      return ShutdownLayer.pipe(Layer.provideMerge(Served));
    }),
  );
