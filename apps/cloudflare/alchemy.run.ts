import * as PlanetscaleLogicalDb from "@macrograph/planetscale-logical-db";
import * as Alchemy from "alchemy";
import * as Axiom from "alchemy/Axiom";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Command from "alchemy/Command";
import * as Drizzle from "alchemy/Drizzle";
import * as Planetscale from "alchemy/Planetscale";
import { Layer } from "effect";
import * as Effect from "effect/Effect";

import { DurableObjectMigrationBundle } from "./src/editor/DurableObjectMigrationBundle.ts";
import { traceDatasetName } from "./src/Observability.ts";
import {
	DatabaseHyperdrive,
	DeploymentSnapshotsBucket,
	FunctionWorkQueue,
	LegacyLogicalDatabase,
} from "./src/Storage.ts";
import CloudWorkerLayer, {
	CloudWorker,
	IngressPublicOrigin,
	WebAssetsDirectory,
} from "./src/worker/CloudWorker.ts";
import { IngressWorker } from "./src/worker/IngressWorker.ts";
import IngressWorkerLayer from "./src/worker/IngressWorkerLayer.ts";

export default Alchemy.Stack(
	"MacroGraph",
	{
		providers: Layer.mergeAll(
			Cloudflare.providers(),
			Axiom.providers(),
			Drizzle.providers(),
			Planetscale.providers(),
			PlanetscaleLogicalDb.providers(),
			DurableObjectMigrationBundle.providers(),
		),
		state: Cloudflare.state(),
	},
	Effect.gen(function* () {
		const ctx = yield* Alchemy.AlchemyContext;
		yield* DatabaseHyperdrive;
		yield* DeploymentSnapshotsBucket;
		yield* FunctionWorkQueue;
		const legacyDatabase = yield* LegacyLogicalDatabase;

		const frontendBuild = !ctx.dev
			? yield* Command.Build("WebAppBuild", {
					command: "pnpm run build",
					cwd: "frontend",
					outdir: "dist",
					memo: false,
					env: {
						...(process.env.AXIOM_ORG_ID === undefined
							? {}
							: { VITE_AXIOM_ORG_ID: process.env.AXIOM_ORG_ID }),
						VITE_AXIOM_TRACE_DATASET: traceDatasetName,
					},
				})
			: undefined;

		const { cloudWorker, ingressWorker } = yield* Effect.gen(function* () {
			const ingressWorker = yield* IngressWorker;
			const cloudWorker = yield* CloudWorker.pipe(
				Effect.provide(CloudWorkerLayer),
				Effect.provideService(WebAssetsDirectory, frontendBuild?.outdir),
				Effect.provideService(IngressPublicOrigin, ingressWorker.url),
			);
			return { cloudWorker, ingressWorker };
		}).pipe(Effect.provide(IngressWorkerLayer));
		return {
			legacyDatabaseName: legacyDatabase.name,
			url: ctx.dev ? "http://0.0.0.0:5175/" : cloudWorker.url,
			...(!ctx.dev && {
				publicWorkerUrl: cloudWorker.url,
				publicIngressUrl: ingressWorker.url,
			}),
		};
	}),
);
