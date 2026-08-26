import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer } from "effect";
import * as Path from "effect/Path";
import {
	Etag,
	HttpMiddleware,
	HttpPlatform,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";

import * as Database from "../database/Database.ts";
import { IngressApi } from "../ingress/IngressApi.ts";
import * as IngressHandlers from "../ingress/IngressHandlers.ts";
import { ProjectIngressDOLayer } from "../ingress/ProjectIngressDO.ts";
import { ObservabilityLayer } from "../Observability.ts";
import { DatabaseHyperdrive, DeploymentSnapshotsBucket } from "../Storage.ts";
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
		compressResponse: () =>
			Effect.die("compression is unavailable in the Cloudflare Worker"),
	},
	fileResponse: () =>
		Effect.die("fileResponse is unavailable in the Cloudflare Worker"),
	fileWebResponse: () =>
		Effect.die("fileWebResponse is unavailable in the Cloudflare Worker"),
});

export default Layer.unwrap(
	Effect.gen(function* () {
		const databaseResource = yield* DatabaseHyperdrive;
		const deploymentsResource = yield* DeploymentSnapshotsBucket;

		return IngressWorker.make(
			{
				main: import.meta.url,
				env: {
					TWITCH_CLIENT_ID: TwitchClientIdConfig,
					TWITCH_CLIENT_SECRET: TwitchClientSecretConfig,
				},
				dev: { port: 1338, strictPort: true },
			},
			Effect.gen(function* () {
				const workerOperations =
					yield* CloudWorkerOperations.make(deploymentsResource);
				const app = yield* HttpApiBuilder.layer(IngressApi).pipe(
					Layer.provide(IngressHandlers.make(workerOperations)),
					Layer.provide([Etag.layer, HttpPlatformStub, Path.layer]),
					HttpRouter.toHttpEffect,
				);

				return {
					...workerOperations,
					fetch: Effect.gen(function* () {
						const request = yield* HttpServerRequest.HttpServerRequest;
						if (
							request.method === "POST" &&
							new URL(request.url, "http://localhost:1338").pathname ===
								"/__macrograph/reconcile-ingress" &&
							(request.headers.host === "localhost:1338" ||
								request.headers.host === "127.0.0.1:1338")
						) {
							const publicOrigin =
								request.headers["x-macrograph-public-origin"];
							if (publicOrigin === undefined)
								return HttpServerResponse.empty({ status: 400 });
							const count =
								yield* workerOperations.reconcileDeployments(publicOrigin);
							return yield* HttpServerResponse.json({ count }).pipe(
								Effect.orDie,
							);
						}
						return yield* app.pipe(HttpMiddleware.cors());
					}),
				};
			}).pipe(
				Effect.provide(ProjectIngressDOLayer),
				Effect.provide(Database.layer(databaseResource)),
				Effect.provide(Cloudflare.Hyperdrive.ConnectBinding),
				Effect.provide(Cloudflare.R2.ReadBucketBinding),
				Effect.provide(Cloudflare.R2.ReadWriteBucketBinding),
				Effect.provide(ObservabilityLayer),
			),
		);
	}),
);
