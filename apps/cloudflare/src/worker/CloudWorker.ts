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

import { Api } from "../api/Api.ts";
import * as CloudApiHandlers from "../api/CloudApiHandlers.ts";
import * as CloudMcp from "../api/CloudMcp.ts";
import * as Authentication from "../auth/Authentication.ts";
import * as Credential from "../auth/Credential.ts";
import * as CredentialPolicy from "../auth/CredentialPolicy.ts";
import * as Database from "../database/Database.ts";
import * as Deployment from "../deployment/Deployment.ts";
import * as DeploymentPolicy from "../deployment/DeploymentPolicy.ts";
import * as EditorRpc from "../editor/EditorRpc.ts";
import * as EditorRpcPolicy from "../editor/EditorRpcPolicy.ts";
import * as Event from "../execution/Event.ts";
import * as EventPolicy from "../execution/EventPolicy.ts";
import { ObservabilityLayer } from "../Observability.ts";
import * as Project from "../project/Project.ts";
import * as ProjectPolicy from "../project/ProjectPolicy.ts";
import { DatabaseHyperdrive, DeploymentSnapshotsBucket } from "../Storage.ts";
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

/** Defines the Cloudflare Worker hosting cloud APIs, editor connections, and web assets. */
export class CloudWorker extends Cloudflare.Worker<CloudWorker, {}>()(
	"CloudWorker",
) {}

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
		const assetsDir = Option.getOrUndefined(
			yield* Effect.serviceOption(WebAssetsDirectory),
		);
		const ingressPublicOrigin = Option.getOrUndefined(
			yield* Effect.serviceOption(IngressPublicOrigin),
		);
		const databaseResource = yield* DatabaseHyperdrive;
		const deploymentsResource = yield* DeploymentSnapshotsBucket;

		return CloudWorker.make(
			{
				main: import.meta.url,
				...(ingressPublicOrigin === undefined
					? {}
					: {
							env: {
								INGRESS_PUBLIC_ORIGIN: Output.map(
									ingressPublicOrigin,
									(origin) => origin ?? "",
								),
							},
						}),
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
				const workerOperations =
					yield* Cloudflare.Workers.bindWorker(IngressWorker);
				const policies = Layer.mergeAll(
					CredentialPolicy.layer,
					DeploymentPolicy.layer,
					EditorRpcPolicy.layer,
					EventPolicy.layer,
				).pipe(
					Layer.provideMerge(
						Layer.mergeAll(ProjectPolicy.layer, TeamPolicy.layer),
					),
				);
				const services = Layer.mergeAll(
					Credential.layer,
					EditorRpc.layer,
					Event.layer,
				).pipe(
					Layer.provideMerge(
						Deployment.layer(workerOperations, deploymentsResource),
					),
					Layer.provideMerge(
						Project.layer(workerOperations, deploymentsResource),
					),
					Layer.provideMerge(Team.layer),
					Layer.provideMerge(Authentication.layer),
					Layer.provideMerge(policies),
					Layer.provideMerge(Database.layer(databaseResource)),
				);

				return yield* Effect.gen(function* () {
					const authentication = yield* Authentication.Service;
					const project = yield* Project.Service;
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
						listGraphs: project.listGraphs,
						getGraph: project.getGraph,
						createGraph: project.createGraph,
						deleteGraph: project.deleteGraph,
						searchSchemas: project.searchSchemas,
						listResources: project.listResources,
						createNode: project.createNode,
						createConnection: project.createConnection,
					});
					const routes = Layer.mergeAll(apiRoutes, docsRoutes, mcpRoutes);
					const app = yield* routes.pipe(HttpRouter.toHttpEffect);

					return {
						fetch: Effect.gen(function* () {
							const request = yield* HttpServerRequest.HttpServerRequest;
							if (
								new URL(request.url, "http://main.local").pathname ===
								"/api/mcp"
							) {
								return yield* CloudMcp.authenticated(
									app,
									authentication.authenticateBearer(),
								).pipe(HttpMiddleware.cors());
							}
							if (request.headers.upgrade?.toLowerCase() === "websocket")
								return yield* app;
							return yield* app.pipe(HttpMiddleware.cors());
						}),
					};
				}).pipe(Effect.provide(services));
			}).pipe(
				Effect.provide(Cloudflare.Hyperdrive.ConnectBinding),
				Effect.provide(Cloudflare.R2.ReadBucketBinding),
				Effect.provide(Cloudflare.R2.ReadWriteBucketBinding),
				Effect.provide(ObservabilityLayer),
			),
		);
	}),
);
