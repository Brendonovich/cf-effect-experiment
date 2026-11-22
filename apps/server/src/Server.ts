import type { ModuleCatalog } from "@macrograph/module/ModuleCatalog";
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
import { ModuleEvaluator } from "@macrograph/module-host/ModuleEvaluator";
import { ModuleRegistry } from "@macrograph/module-host/ModuleRegistry";
import { Installer } from "@macrograph/module-installer/Installer";
import { ModuleAdminRpc } from "@macrograph/module/ModuleAdminRpc";
import { ModuleId } from "@macrograph/module/ModuleId";
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
import { join } from "node:path";

import { ApiKeys } from "./ApiKeys.ts";
import { makeAtomicFileStore } from "./AtomicFileStore.ts";
import { ClientSessions } from "./ClientSessions.ts";
import { LocalAccess } from "./LocalAccess.ts";
import { ModuleAdmin } from "./ModuleAdmin.ts";
import { ModuleHost } from "./ModuleHost.ts";
import { Observability } from "./Observability.ts";
import { ProjectApi } from "./ProjectApi.ts";
import { ServerConfig } from "./ServerConfig.ts";
import { ServerSetup } from "./ServerSetup.ts";
import { StaticRoutes } from "./StaticRoutes.ts";
import { version } from "./Version.ts";

const config = ServerConfig.makeServerConfig(process.env);

// Set by `make` before its layers are built. Requests and the setup callback read them then, so a
// process that serves as the background service can announce through its own channel and accept
// its local token; `Main` leaves both at their defaults.
let announce: (line: string) => void = (line) => console.log(line);
let local: LocalAccess.Access = LocalAccess.none;
mkdirSync(config.dataDirectory, { recursive: true });
// The watcher only covers folders that exist when it starts.
mkdirSync(join(config.dataDirectory, "modules", "local"), { recursive: true });
const authFile = makeAtomicFileStore(config.cloudAuthPath);
const cloudCredentials = Effect.runSync(
  CloudCredentials.make({
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
  }).pipe(Effect.provide(FetchHttpClient.layer)),
);
const clientSessions = ClientSessions.make(makeAtomicFileStore(config.clientAuthPath));
const setup = ServerSetup.make({
  store: makeAtomicFileStore(config.ownerPath),
  auth: cloudCredentials.auth,
  sessions: clientSessions,
  onKeyIssued: (key) =>
    Effect.gen(function* () {
      yield* Effect.sync(() => announce(`MACROGRAPH_SETUP_KEY ${key}`));
      // The key goes in the fragment so it is never sent to the server or stored in access logs.
      const setupUrl = `${config.publicOrigin}${config.basePath}/#setup-key=${encodeURIComponent(key)}`;
      yield* Effect.logInfo(`Open ${setupUrl} to set up this server.`);
    }),
});
const serverOwnerId = setup.ownerId;
// Fresh, because layers are memoized by reference and each transport needs its own policy.
const connectionMiddlewareFor = (transport: ClientSessions.Transport) =>
  Layer.fresh(EditorRpc.connectionMiddlewareLayer).pipe(
    Layer.provideMerge(
      Layer.succeed(
        EditorAccess.Policy,
        clientSessions.policy(serverOwnerId, config.adminIds, transport, local),
      ),
    ),
  );
const canEditRequest = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;
    if (local.matches(token)) return true;
    const [session, ownerId] = yield* Effect.all([clientSessions.resolve(token), serverOwnerId]);
    return (
      session !== undefined && (session.userId === ownerId || config.adminIds.has(session.userId))
    );
  });

const WorkspaceRpcs = EditorServer.mergeRpcGroups(
  EditorRpc.EditorRpcs,
  RuntimeActivity.Rpcs,
  ModuleAdminRpc.ModuleAdminRpcs,
).middleware(EditorRpc.ConnectionMiddleware);

// Editor and module admin RPCs for HTTP callers such as scripts; module RPCs have their own routes.
const HttpRpcs = EditorServer.mergeRpcGroups(
  EditorRpc.EditorRpcs,
  ModuleAdminRpc.ModuleAdminRpcs,
).middleware(EditorRpc.ConnectionMiddleware);

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
    yield* (yield* HttpRouter.HttpRouter).prefixed(config.basePath).add("*", "/rpc-ws", httpEffect);
  }),
).pipe(Layer.provide(connectionMiddlewareFor("ws")));

const EditorHttpRpc = Layer.effectDiscard(
  Effect.gen(function* () {
    const httpEffect = yield* RpcServer.toHttpEffect(HttpRpcs);
    yield* (yield* HttpRouter.HttpRouter).prefixed(config.basePath).add("*", "/rpc", httpEffect);
  }),
);

const EditorHttpRoutes = Layer.merge(EditorHttpRpc, WsEndpoints);

const ClientAuthRoutes = Layer.effectDiscard(
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
          local.matches(token) ||
          (session !== undefined &&
            (session.userId === ownerId || config.adminIds.has(session.userId))),
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
        const token = yield* clientSessions.create({ userId: result.userId, email: result.email });
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

const HealthRoute = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = (yield* HttpRouter.HttpRouter).prefixed(config.basePath);
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

const remoteApiRoutes = (local: LocalAccess.Access) =>
  ProjectApi.layer({
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

/** How the server finds and evaluates modules; production and dev differ only here. */
export interface ModuleOptions {
  /** Roots of preinstalled packages laid out as `<namespace>/<publisher>/<name>/<version>/`. */
  readonly shippedDirs: ReadonlyArray<string>;
  readonly evaluator: Layer.Layer<ModuleEvaluator.Service>;
  /** More folders to watch for staleness, e.g. built-in sources in dev. */
  readonly extraWatchDirs?: ReadonlyArray<{ readonly dir: string; readonly id: ModuleId.Id }>;
  /** Reload local modules when their files change instead of marking them stale, e.g. in dev. */
  readonly autoReloadLocalModules?: boolean;
  /** Adjusts catalog entries after the base path is applied, e.g. dev UI source URLs. */
  readonly mapEntry?: (entry: ModuleCatalog.Entry) => ModuleCatalog.Entry;
}

const credentialsLayer = Layer.succeed(Engine.Credentials, {
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
              new Credential.AuthError({ reason: "Set up this server before connecting it" }),
            )
          : cloudCredentials.pollOwner(ownerId),
      ),
    ),
  },
});

const InstallerLayer = Installer.layer({
  dataDir: config.dataDirectory,
  official: { url: config.registryUrl, keys: config.registryKeys },
}).pipe(Layer.orDie);

const nodeServer = createServer();
const sockets = new Set<Socket>();
nodeServer.on("connection", (socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});
nodeServer.on("listening", () => {
  if (config.behindDevProxy) return;
  const address = nodeServer.address();
  if (typeof address === "object" && address !== null)
    console.log(`MACROGRAPH_LISTENING ${address.port}`);
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

const pathGuard = HttpMiddleware.make((httpEffect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return StaticRoutes.isUnsafePath(request.originalUrl)
      ? HttpServerResponse.text("Invalid path", { status: 400 })
      : yield* httpEffect;
  }),
);

const setupUrl = (config: ServerConfig.Config, key: string) =>
  `${config.publicOrigin}${config.basePath}/#setup-key=${encodeURIComponent(key)}`;

/** Lets the local agents' CLI find the service and its setup link before the app is serving. */
const InfoRoute = (local: LocalAccess.Access) =>
  local.enabled
    ? Layer.effectDiscard(
        Effect.gen(function* () {
          const router = (yield* HttpRouter.HttpRouter).prefixed(config.basePath);
          yield* router.add(
            "GET",
            "/api/info",
            Effect.gen(function* () {
              const request = yield* HttpServerRequest.HttpServerRequest;
              if (!local.matches(LocalAccess.bearer(request.headers.authorization)))
                return HttpServerResponse.empty({ status: 401 });
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
      )
    : Layer.empty;

/**
 * Answers requests that arrive after the server is bound but before the app is serving them, so
 * clients can tell a booting server from a dead one. It steps aside once the app's handler is
 * attached.
 */
const bootingResponder =
  (server: ReturnType<typeof createServer>, local: LocalAccess.Access) =>
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

export interface ServiceOptions {
  /** Authenticates the background service's local token as the owner. */
  readonly local?: LocalAccess.Access;
  /** Writes the machine-readable `MACROGRAPH_SETUP_KEY` and `MACROGRAPH_LISTENING` lines. */
  readonly announce?: (line: string) => void;
  /** Runs once the HTTP server is listening, before the app is built. */
  readonly onListen?: (port: number) => Effect.Effect<void, never, Scope.Scope>;
}

export const make = (modules: ModuleOptions & ServiceOptions) => {
  local = modules.local ?? LocalAccess.none;
  if (modules.announce !== undefined) announce = modules.announce;

  const mapEntry = (entry: ModuleCatalog.Entry) => {
    const prefixed = ModuleHost.withBasePath(config.basePath)(entry);
    return modules.mapEntry === undefined ? prefixed : modules.mapEntry(prefixed);
  };

  // Loads every enabled module while it is built, before the HTTP server starts listening.
  const Modules = ModuleAdmin.backgroundLayer.pipe(
    Layer.provideMerge(
      ModuleRegistry.layer({
        dataDir: config.dataDirectory,
        shippedDirs: modules.shippedDirs,
        hostServices: ModuleHost.hostServices,
        watch: {
          extraDirs: modules.extraWatchDirs ?? [],
          ...(modules.autoReloadLocalModules === true ? { autoReload: true } : {}),
        },
      }).pipe(Layer.provide([ModuleHost.mounterLayer, modules.evaluator, ModuleAdmin.trustLayer])),
    ),
    Layer.provideMerge(InstallerLayer),
  );

  const ApiRoutes = Layer.mergeAll(
    EditorHttpRoutes,
    ClientAuthRoutes,
    remoteApiRoutes(local),
    ModuleHost.routes({ basePath: config.basePath, canEditRequest }),
    HealthRoute,
    InfoRoute(local),
  );

  const StaticRoute = StaticRoutes.layer({
    root: config.assetsDirectory,
    basePath: config.basePath,
    publicOrigin: config.publicOrigin,
    ...(config.browserOtlpEndpoint === undefined
      ? {}
      : { otlpEndpoint: config.browserOtlpEndpoint }),
  });

  const AppLayer = ApiRoutes.pipe(
    Layer.provideMerge(StaticRoute),
    Layer.provide(EditorRpc.handlerLayer),
    Layer.provide(RuntimeActivity.handlerLayer),
    Layer.provide(
      ModuleAdmin.handlerLayer({
        mapEntry,
        officialNamespace: ModuleId.OfficialNamespace,
        officialKeysConfigured: config.registryKeys.length > 0,
      }),
    ),
    // The editor HTTP RPC server shares this; the WebSocket server has its own.
    Layer.provide(connectionMiddlewareFor("http")),
    Layer.provide(RpcSerialization.layerJsonRpc()),
  );

  const CoreLayer = Modules.pipe(
    Layer.provideMerge(LiveRuntimeLayer),
    Layer.provideMerge(RuntimeActivity.layer),
    Layer.provideMerge(QueueRuntime.layer),
    Layer.provideMerge(credentialsLayer),
    Layer.provideMerge(SqlitePersistence.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        DrizzleDriver.layerNodeSqlite(config.databasePath, config.migrationsDirectory),
        NodeServices.layer,
      ),
    ),
    // Issues and logs a setup key while the server is unclaimed.
    Layer.provideMerge(
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

  nodeServer.on("request", bootingResponder(nodeServer, local));

  const Listening =
    modules.onListen === undefined
      ? Layer.empty
      : Layer.effectDiscard(
          Effect.suspend(() => {
            const address = nodeServer.address();
            return typeof address === "object" && address !== null
              ? modules.onListen!(address.port)
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
    Layer.provide(CoreLayer),
    Layer.provide(Observability.layer(config)),
    Layer.provide(Layer.mergeAll(FetchHttpClient.layer, NodeSocket.layerWebSocketConstructor)),
  );

  // This outer layer is acquired last, so it quiesces sockets before the HTTP server waits to close.
  return ShutdownLayer.pipe(Layer.provideMerge(Served));
};

/** Runs this build's modules, including as the background service or the foreground server. */
export const service = (options: ServiceOptions = {}) =>
  make({ shippedDirs: [config.modulesDirectory], evaluator: ModuleEvaluator.vm, ...options });

/** Shipped built-ins from `dist/modules`, evaluated with the `vm` loader. */
export const Main = make({ shippedDirs: [config.modulesDirectory], evaluator: ModuleEvaluator.vm });
