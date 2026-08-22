import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import { Context, Effect, Layer, Option } from "effect";
import * as Path from "effect/Path";
import {
  Etag,
  HttpMiddleware,
  HttpPlatform,
  HttpRouter,
  HttpServerRequest,
} from "effect/unstable/http";
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";

import { Api } from "./Api.ts";
import { AppDatabaseHyperdrive, RevisionSnapshots } from "./AppStorage.ts";
import * as CloudHttp from "./Http.ts";
import { ObservabilityLayer } from "./Observability.ts";
import * as RuntimeHttp from "./runtime/Http.ts";
import * as Runtime from "./runtime/Runtime.ts";

export class WebAssetsDirectory extends Context.Service<
  WebAssetsDirectory,
  Alchemy.Output<string> | undefined
>()("WebAssetsDirectory") {}

export class AppWorker extends Cloudflare.Worker<AppWorker, {}>()("AppWorker") {}

const HttpPlatformStub = Layer.succeed(HttpPlatform.HttpPlatform, {
  fileResponse: () => Effect.die("fileResponse is unavailable in the Cloudflare Worker"),
  fileWebResponse: () => Effect.die("fileWebResponse is unavailable in the Cloudflare Worker"),
});

export default Layer.unwrap(
  Effect.gen(function* () {
    const assetsDir = Option.getOrUndefined(
      (yield* Effect.serviceOption(WebAssetsDirectory)) ?? Option.none(),
    );
    const databaseResource = yield* AppDatabaseHyperdrive;
    const revisionsResource = yield* RevisionSnapshots;

    return AppWorker.make(
      {
        main: import.meta.url,
        assets: assetsDir
          ? Output.map(assetsDir, (directory) => ({
              directory,
              htmlHandling: "auto-trailing-slash",
              notFoundHandling: "single-page-application",
            }))
          : undefined,
        dev: { port: 1337, strictPort: true },
      },
      Effect.gen(function* () {
        const runtime = yield* Runtime.make(databaseResource, revisionsResource);
        const cloud = yield* CloudHttp.make(runtime, databaseResource, revisionsResource);
        const runtimeRoutes = yield* RuntimeHttp.make(runtime);
        const cloudHandlers = cloud.handlers.pipe(Layer.provide(cloud.authentication));
        const apiRoutes = HttpApiBuilder.layer(Api, { openapiPath: "/api/openapi.json" }).pipe(
          Layer.provide(cloud.authentication),
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
        const routes = Layer.mergeAll(apiRoutes, docsRoutes, cloud.rpcRoutes, runtimeRoutes);
        const app = yield* routes.pipe(HttpRouter.toHttpEffect);

        return {
          fetch: Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            if (request.headers.upgrade?.toLowerCase() === "websocket") return yield* app;
            return yield* app.pipe(HttpMiddleware.cors());
          }).pipe(Effect.provide(ObservabilityLayer)),
        };
      }).pipe(
        Effect.provide(Cloudflare.Hyperdrive.ConnectBinding),
        Effect.provide(Cloudflare.R2.ReadBucketBinding),
        Effect.provide(Cloudflare.R2.ReadWriteBucketBinding),
        Effect.provide(ObservabilityLayer),
      ),
    );
  }),
);
