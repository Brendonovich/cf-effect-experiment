import * as Cloudflare from "@alchemy.run/cloudflare";
import { Effect, Layer } from "effect";
import {
  Etag,
  HttpMiddleware,
  HttpPlatform,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import * as Path from "effect/Path";

import * as Database from "../database/Database.ts";
import GatewayDO, { GatewayDOLayer } from "../gateway/GatewayDO.ts";
import {
  AppIdConfig as GitHubAppIdConfig,
  PrivateKeyConfig as GitHubPrivateKeyConfig,
} from "../GitHubCredentials.ts";
import { IngressApi } from "../ingress/IngressApi.ts";
import * as IngressHandlers from "../ingress/IngressHandlers.ts";
import { ProjectIngressDOLayer } from "../ingress/ProjectIngressDO.ts";
import { ObservabilityLayer } from "../Observability.ts";
import { OpenCodeDOLayer } from "../opencode/OpenCodeDO.ts";
import { DatabaseHyperdrive, DeploymentObjectsBucket } from "../Storage.ts";
import {
  ClientIdConfig as TwitchClientIdConfig,
  ClientSecretConfig as TwitchClientSecretConfig,
} from "../TwitchCredentials.ts";
import * as CloudWorkerOperations from "./CloudWorkerOperations.ts";
import { IngressWorker } from "./IngressWorker.ts";

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
    const databaseResource = yield* DatabaseHyperdrive;
    const deploymentsResource = yield* DeploymentObjectsBucket;

    return IngressWorker.make(
      {
        main: import.meta.url,
        env: {
          TWITCH_CLIENT_ID: TwitchClientIdConfig,
          TWITCH_CLIENT_SECRET: TwitchClientSecretConfig,
          GITHUB_APP_ID: GitHubAppIdConfig,
          GITHUB_APP_PRIVATE_KEY: GitHubPrivateKeyConfig,
        },
        dev: { port: 1338, strictPort: true },
      },
      Effect.gen(function* () {
        const workerOperations = yield* CloudWorkerOperations.make(deploymentsResource);
        const gatewayDos = yield* GatewayDO;
        const app = yield* HttpApiBuilder.layer(IngressApi).pipe(
          Layer.provide(IngressHandlers.make(workerOperations)),
          Layer.provide([Etag.layer, HttpPlatformStub, Path.layer]),
          HttpRouter.toHttpEffect,
        );

        return {
          ...workerOperations,
          fetch: Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            // Provider webhooks for a user's gateway: `/gateway/:userId/:endpointId`.
            const gatewayHook = /^\/gateway\/([^/]+)\/([^/]+)$/.exec(
              new URL(request.url, "http://localhost:1338").pathname,
            );
            if (gatewayHook !== null && request.method === "POST") {
              const body = yield* request.arrayBuffer.pipe(Effect.orDie);
              const response = yield* gatewayDos
                .getByName(decodeURIComponent(gatewayHook[1] ?? ""))
                .ingress({
                  endpointId: decodeURIComponent(gatewayHook[2] ?? ""),
                  method: request.method,
                  headers: Object.entries(request.headers).flatMap(([name, value]) =>
                    typeof value === "string" ? [[name, value] as const] : [],
                  ),
                  body: new Uint8Array(body),
                })
                .pipe(Effect.orDie);
              return response.body === undefined
                ? HttpServerResponse.empty({ status: response.status })
                : HttpServerResponse.text(response.body, {
                    status: response.status,
                    ...(response.contentType === undefined
                      ? {}
                      : { contentType: response.contentType }),
                  });
            }
            if (
              request.method === "POST" &&
              new URL(request.url, "http://localhost:1338").pathname ===
                "/__macrograph/reconcile-ingress" &&
              (request.headers.host === "localhost:1338" ||
                request.headers.host === "127.0.0.1:1338")
            ) {
              const publicOrigin = request.headers["x-macrograph-public-origin"];
              if (publicOrigin === undefined) return HttpServerResponse.empty({ status: 400 });
              const count = yield* workerOperations.reconcileDeployments(publicOrigin);
              return yield* HttpServerResponse.json({ count }).pipe(Effect.orDie);
            }
            return yield* app.pipe(HttpMiddleware.cors());
          }),
        };
      }).pipe(
        Effect.provide(ProjectIngressDOLayer),
        Effect.provide(OpenCodeDOLayer),
        Effect.provide(GatewayDOLayer),
        Effect.provide(Database.layer(databaseResource)),
        Effect.provide(Cloudflare.Hyperdrive.ConnectBinding),
        Effect.provide(Cloudflare.R2.ReadBucketBinding),
        Effect.provide(Cloudflare.R2.ReadWriteBucketBinding),
        Effect.provide(ObservabilityLayer),
      ),
    );
  }),
);
