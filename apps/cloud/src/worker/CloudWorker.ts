import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import { Context, Effect, Layer, Option, Redacted } from "effect";
import {
  Etag,
  HttpMiddleware,
  HttpPlatform,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api";
import * as Path from "effect/Path";

import { Api } from "../api/Api.ts";
import * as CloudApiHandlers from "../api/CloudApiHandlers.ts";
import * as CloudMcp from "../api/CloudMcp.ts";
import * as CloudMount from "../api/CloudMount.ts";
import { cloudPathPrefix } from "../api/HttpOrigin.ts";
import * as Authentication from "../auth/Authentication.ts";
import * as Credential from "../auth/Credential.ts";
import * as CredentialPolicy from "../auth/CredentialPolicy.ts";
import * as McpOAuth from "../auth/McpOAuth.ts";
import * as OAuthProviders from "../auth/OAuthProviders.ts";
import * as Database from "../database/Database.ts";
import * as Deployment from "../deployment/Deployment.ts";
import * as DeploymentPolicy from "../deployment/DeploymentPolicy.ts";
import * as EditorRpc from "../editor/EditorRpc.ts";
import * as EditorRpcPolicy from "../editor/EditorRpcPolicy.ts";
import * as Event from "../execution/Event.ts";
import * as EventPolicy from "../execution/EventPolicy.ts";
import { ObservabilityLayer } from "../Observability.ts";
import OpenCodeDO from "../opencode/OpenCodeDO.ts";
import * as Project from "../project/Project.ts";
import * as ProjectPolicy from "../project/ProjectPolicy.ts";
import * as PublicHost from "../PublicHost.ts";
import { DatabaseHyperdrive, DeploymentObjectsBucket } from "../Storage.ts";
import * as Team from "../team/Team.ts";
import * as TeamPolicy from "../team/TeamPolicy.ts";
import { IngressWorker } from "./IngressWorker.ts";

/** Provides the optional directory of static web assets served by the worker. */
export class WebAssetsDirectory extends Context.Service<
  WebAssetsDirectory,
  Alchemy.Output<string> | undefined
>()("WebAssetsDirectory") {}

export class IngressPublicOrigin extends Context.Service<
  IngressPublicOrigin,
  Alchemy.Output<string | undefined>
>()("IngressPublicOrigin") {}

/**
 * Hosts Cloud's APIs, editor connections, and web app at `/cloud` on the main site, via Worker
 * Routes that run ahead of WebsiteWorker's Custom Domain.
 */
export class CloudWorker extends Cloudflare.Worker<CloudWorker, {}>()("CloudWorker") {}

const HttpPlatformStub = Layer.succeed(HttpPlatform.HttpPlatform, {
  platform: "web",
  compression: {
    algorithms: new Set<HttpPlatform.CompressionAlgorithm>(),
    compressResponse: () => Effect.die("compression is unavailable in the Cloudflare Worker"),
  },
  fileResponse: () => Effect.die("fileResponse is unavailable in the Cloudflare Worker"),
  fileWebResponse: () => Effect.die("fileWebResponse is unavailable in the Cloudflare Worker"),
});

export default Layer.unwrap(
  Effect.gen(function* () {
    const assetsDir = Option.getOrUndefined(yield* Effect.serviceOption(WebAssetsDirectory));
    const ingressPublicOrigin = Option.getOrUndefined(
      yield* Effect.serviceOption(IngressPublicOrigin),
    );
    const databaseResource = yield* DatabaseHyperdrive;
    const deploymentsResource = yield* DeploymentObjectsBucket;
    const credentialEnvironment = Object.fromEntries(
      ["TWITCH", "DISCORD", "GITHUB", "SPOTIFY", "GOOGLE", "PATREON", "STREAMLABS"].flatMap(
        (provider) => {
          const clientId = process.env[`${provider}_CLIENT_ID`] || undefined;
          const clientSecret = process.env[`${provider}_CLIENT_SECRET`] || undefined;
          return [
            ...(clientId === undefined ? [] : [[`${provider}_CLIENT_ID`, clientId] as const]),
            ...(clientSecret === undefined
              ? []
              : [[`${provider}_CLIENT_SECRET`, Redacted.make(clientSecret)] as const]),
          ];
        },
      ),
    );
    // `Stack` is available both while deploying and at runtime, so the props match in each.
    const { stage } = yield* Alchemy.Stack;
    const publicHost = PublicHost.forStage(stage);
    return CloudWorker.make(
      {
        // Cloud claims `/cloud` on the stage's hostname with Worker Routes, which Cloudflare runs
        // before WebsiteWorker's Custom Domain, so both apps share the origin and session cookie.
        ...(publicHost === undefined
          ? {}
          : { routes: CloudMount.routePatterns(publicHost).map((pattern) => ({ pattern })) }),
        main: import.meta.url,
        env: {
          ...credentialEnvironment,
          MCP_OAUTH_PUBLIC_ORIGIN:
            process.env.MCP_OAUTH_PUBLIC_ORIGIN ??
            `https://${publicHost ?? PublicHost.zoneName}${cloudPathPrefix}`,
          ...(ingressPublicOrigin === undefined
            ? {}
            : {
                INGRESS_PUBLIC_ORIGIN: Output.map(ingressPublicOrigin, (origin) => origin ?? ""),
              }),
        },
        assets: assetsDir
          ? Output.map(assetsDir, (directory) => ({
              directory,
              htmlHandling: "auto-trailing-slash",
              notFoundHandling: "single-page-application",
              // Requests arrive under `/cloud`, which the worker strips before serving assets.
              runWorkerFirst: true,
            }))
          : undefined,
        dev: { port: 1337, strictPort: true },
      },
      Effect.gen(function* () {
        const workerOperations = yield* Cloudflare.Workers.bindWorker(IngressWorker);
        // Binds IngressWorker's OpenCodeDO namespace for ProjectEditorDO's managed connections.
        yield* OpenCodeDO.from(IngressWorker);
        const mcpOAuthRegistrationRateLimit = yield* Cloudflare.RateLimit(
          "MCP_OAUTH_REGISTRATION_RATE_LIMIT",
          {
            namespaceId: 1001,
            simple: { limit: 10, period: 60 },
          },
        );
        const policies = Layer.mergeAll(
          CredentialPolicy.layer,
          DeploymentPolicy.layer,
          EditorRpcPolicy.layer,
          EventPolicy.layer,
        ).pipe(Layer.provideMerge(Layer.mergeAll(ProjectPolicy.layer, TeamPolicy.layer)));
        const services = Layer.mergeAll(EditorRpc.layer, Event.layer(workerOperations)).pipe(
          Layer.provideMerge(Credential.layer),
          Layer.provideMerge(Deployment.layer(workerOperations, deploymentsResource)),
          Layer.provideMerge(Project.layer(workerOperations, deploymentsResource)),
          Layer.provideMerge(Team.layer),
          Layer.provideMerge(Authentication.layer),
          Layer.provideMerge(OAuthProviders.layer),
          Layer.provideMerge(policies),
          Layer.provideMerge(Database.layer(databaseResource)),
        );

        return yield* Effect.gen(function* () {
          const authentication = yield* Authentication.Service;
          const project = yield* Project.Service;
          const event = yield* Event.Service;
          const cloudHandlers = CloudApiHandlers.layer.pipe(
            Layer.provide(Authentication.middleware),
          );
          const apiRoutes = HttpApiBuilder.layer(Api, {
            openapiPath: "/api/openapi.json",
          }).pipe(
            Layer.provide(Authentication.middleware),
            Layer.provide(cloudHandlers),
            Layer.provide([Etag.layer, HttpPlatformStub, Path.layer]),
          );
          const docsRoutes = HttpApiScalar.layer(Api, {
            path: "/api/docs",
            scalar: {
              darkMode: true,
              defaultOpenAllTags: true,
              showOperationId: true,
              theme: "default",
            },
          });
          const mcpRoutes = CloudMcp.layer({
            listProjects: project.list,
            getProject: project.get,
            createProject: project.create,
            listExecutions: ({ projectId, deploymentId, status, limit }) =>
              event.listExecutions(projectId, deploymentId).pipe(
                Effect.map(({ executions, events }) => {
                  const eventsById = new Map(events.map((record) => [record.id, record]));
                  return {
                    executions: executions
                      .filter((execution) => status === undefined || execution.status === status)
                      .slice(0, limit ?? 20)
                      .map((execution) => {
                        const record = eventsById.get(execution.projectEventId);
                        return {
                          ...execution,
                          eventType: record?.eventType ?? null,
                          traceId: record?.traceId ?? null,
                        };
                      }),
                  };
                }),
              ),
            getExecution: ({ projectId, executionId }) =>
              event.getExecution(projectId, executionId).pipe(
                Effect.map((result) => ({
                  ...result,
                  trace: CloudMcp.executionTrace(result.event.traceId),
                })),
              ),
            listGraphs: project.listGraphs,
            getGraph: project.getGraph,
            createGraph: project.createGraph,
            deleteGraph: project.deleteGraph,
            searchSchemas: project.searchSchemas,
            listResources: project.listResources,
            createNode: project.createNode,
            createConnection: project.createConnection,
          });
          const routes = Layer.mergeAll(
            apiRoutes,
            docsRoutes,
            mcpRoutes,
            McpOAuth.layer({
              authenticateSession: authentication.authenticateSession,
              limitRegistration: (key) => mcpOAuthRegistrationRateLimit.limit({ key }),
            }),
          );
          const app = yield* routes.pipe(HttpRouter.toHttpEffect);

          return {
            fetch: Effect.gen(function* () {
              const request = yield* HttpServerRequest.HttpServerRequest;
              if (!(request.source instanceof Request)) return yield* app;
              const url = new URL(request.source.url);
              const resolved = CloudMount.resolve(url.pathname, url.search);
              if (resolved._tag === "Redirect")
                return HttpServerResponse.redirect(resolved.location, { status: 301 });
              const target = new URL(url);
              target.pathname = resolved.path;
              const forwarded = new Request(target, request.source);
              // Only CloudWorker decides the mount; never trust a client-supplied prefix.
              forwarded.headers.delete("x-forwarded-prefix");
              if (resolved.mounted) forwarded.headers.set("x-forwarded-prefix", cloudPathPrefix);
              if (resolved._tag === "Assets") {
                const environment = yield* Cloudflare.WorkerEnvironment;
                const assets: { fetch: (request: Request) => Promise<Response> } | undefined =
                  environment.ASSETS;
                if (assets === undefined) return HttpServerResponse.empty({ status: 404 });
                const response = yield* Effect.promise(() => assets.fetch(forwarded));
                return HttpServerResponse.raw(response, { status: response.status });
              }
              const application = Effect.gen(function* () {
                if (resolved.path === "/api/mcp")
                  return yield* CloudMcp.authenticated(
                    app,
                    authentication.authenticateMcpBearer(),
                  ).pipe(HttpMiddleware.cors());
                if (forwarded.headers.get("upgrade")?.toLowerCase() === "websocket")
                  return yield* app;
                return yield* app.pipe(HttpMiddleware.cors());
              });
              return yield* application.pipe(
                Effect.provideService(
                  HttpServerRequest.HttpServerRequest,
                  HttpServerRequest.fromWeb(forwarded),
                ),
              );
            }),
          };
        }).pipe(Effect.provide(services));
      }).pipe(
        Effect.provide(Alchemy.RuntimeContext.phantom),
        Effect.provide(Cloudflare.Hyperdrive.ConnectBinding),
        Effect.provide(Cloudflare.R2.ReadBucketBinding),
        Effect.provide(Cloudflare.R2.ReadWriteBucketBinding),
        Effect.provide(Cloudflare.Workers.RateLimitBinding),
        Effect.provide(ObservabilityLayer),
      ),
    );
  }),
);
