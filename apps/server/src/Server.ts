import type { Socket } from "node:net";

import { NodeHttpServer, NodeServices, NodeSocket } from "@effect/platform-node";
import { CloudCredentials, SessionStoreError } from "@macrograph/cloud-credentials";
import {
  Editor,
  EditorAccess,
  EditorEvents,
  EditorRpc,
  EditorServer,
  Packages,
  Presence,
} from "@macrograph/editor";
import { RuntimeActivity } from "@macrograph/execution";
import { DrizzleDriver, SqlitePersistence } from "@macrograph/persistence-sqlite";
import { Engine } from "@macrograph/plugin";
import { Effect, Layer } from "effect";
import {
  FetchHttpClient,
  HttpMiddleware,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import Deployments from "virtual:macrograph-plugin-deployments";

import { makeAtomicFileStore } from "./AtomicFileStore.ts";
import { ClientSessions } from "./ClientSessions.ts";
import { Observability } from "./Observability.ts";
import { PluginHost } from "./PluginHost.ts";
import { ProjectExecution } from "./ProjectExecution.ts";
import { ServerConfig } from "./ServerConfig.ts";
import { ServerSetup } from "./ServerSetup.ts";
import { StaticRoutes } from "./StaticRoutes.ts";

const config = ServerConfig.makeServerConfig(process.env);
mkdirSync(config.dataDirectory, { recursive: true });
const authFile = makeAtomicFileStore(config.cloudAuthPath);
const cloudCredentials = Effect.runSync(
  CloudCredentials.make({
    baseUrl: config.cloudBaseUrl,
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
  legacyAuthStore: authFile,
  auth: cloudCredentials.auth,
  sessions: clientSessions,
});
const serverOwnerId = setup.ownerId;
const accessPolicy = clientSessions.policy(serverOwnerId, config.adminIds);
const canEditRequest = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* () {
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;
    const [session, ownerId] = yield* Effect.all([clientSessions.resolve(token), serverOwnerId]);
    return (
      session !== undefined && (session.userId === ownerId || config.adminIds.has(session.userId))
    );
  });

const WorkspaceRpcs = EditorServer.mergeRpcGroups(
  EditorRpc.EditorRpcs,
  RuntimeActivity.Rpcs,
  ...Deployments.flatMap((deployment) =>
    "definition" in deployment ? [deployment.definition.ClientRpcs] : [],
  ),
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
);

const EditorHttpRpc = Layer.effectDiscard(
  Effect.gen(function* () {
    const httpEffect = yield* RpcServer.toHttpEffect(EditorRpc.EditorRpcs);
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
      const [session, ownerId] = yield* Effect.all([clientSessions.resolve(token), serverOwnerId]);
      return {
        user: session ?? null,
        setupRequired: ownerId === undefined,
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
      cloudCredentials.clientAuth.start.pipe(
        Effect.map((authorization) =>
          HttpServerResponse.jsonUnsafe(
            {
              deviceCode: authorization.device_code,
              verificationUrl: authorization.verification_uri_complete,
            },
            { headers: { "cache-control": "no-store" } },
          ),
        ),
        Effect.catch((error) =>
          Effect.succeed(HttpServerResponse.jsonUnsafe({ error: error.reason }, { status: 409 })),
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
        const result = yield* cloudCredentials.clientAuth
          .poll(body.deviceCode)
          .pipe(Effect.mapError((error) => error.reason));
        if (result.state === "pending") return HttpServerResponse.jsonUnsafe(result);
        const token = yield* clientSessions.create({ userId: result.userId, email: result.email });
        return HttpServerResponse.jsonUnsafe(
          { ...result, token },
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

const ProjectExecutionLayer = ProjectExecution.layer.pipe(Layer.provideMerge(EditorLayer));

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

const ApiRoutes = Layer.mergeAll(
  EditorHttpRoutes,
  ClientAuthRoutes,
  PluginHost.rpcRoute(config.basePath, canEditRequest),
  HealthRoute,
);

const StaticRoute = StaticRoutes.layer({
  root: config.assetsDirectory,
  basePath: config.basePath,
  publicOrigin: config.publicOrigin,
  ...(config.browserOtlpEndpoint === undefined ? {} : { otlpEndpoint: config.browserOtlpEndpoint }),
});

const HttpRoutes = ApiRoutes.pipe(Layer.provideMerge(StaticRoute));

const MountedPlugins = Layer.mergeAll(
  Layer.empty,
  ...Deployments.map((deployment) =>
    "definition" in deployment
      ? PluginHost.deploymentLayer(deployment)
      : PluginHost.pluginLayer(deployment),
  ),
);

const AppLayer = HttpRoutes.pipe(
  Layer.provideMerge(MountedPlugins),
  Layer.provide(EditorRpc.handlerLayer),
  Layer.provide(RuntimeActivity.handlerLayer),
  Layer.provide(EditorRpc.connectionMiddlewareLayer),
  Layer.provide(Layer.succeed(EditorAccess.Policy, accessPolicy)),
  Layer.provide(RpcSerialization.layerJsonRpc()),
  Layer.provide(ProjectExecutionLayer),
  Layer.provide(RuntimeActivity.layer),
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
      },
    }),
  ),
  Layer.provide(PluginHost.layer),
  Layer.provide(SqlitePersistence.layer),
  Layer.provide(
    Layer.mergeAll(
      DrizzleDriver.layerNodeSqlite(config.databasePath, config.migrationsDirectory),
      NodeServices.layer,
    ),
  ),
  Layer.provide(
    Layer.effectDiscard(
      Effect.gen(function* () {
        const key = yield* setup.setupKey;
        if (key !== undefined) {
          yield* Effect.sync(() => console.log(`MACROGRAPH_SETUP_KEY ${key}`));
          yield* Effect.logInfo(
            "Open the server in your browser and enter the setup key to configure its administrator.",
          );
        }
      }),
    ),
  ),
);

const nodeServer = createServer();
const sockets = new Set<Socket>();
nodeServer.on("connection", (socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});
nodeServer.on("listening", () => {
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

const Served = HttpRouter.serve(AppLayer, { disableLogger: true, middleware: pathGuard }).pipe(
  Layer.provide(
    NodeHttpServer.layer(() => nodeServer, {
      port: config.port,
      host: config.host,
      gracefulShutdownTimeout: "10 seconds",
    }),
  ),
  Layer.provide(Observability.layer(config)),
  Layer.provide(Layer.mergeAll(FetchHttpClient.layer, NodeSocket.layerWebSocketConstructor)),
);

// This outer layer is acquired last, so it quiesces sockets before the HTTP server waits to close.
export const Main = ShutdownLayer.pipe(Layer.provideMerge(Served));
