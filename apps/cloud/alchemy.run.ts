import type { StackServices } from "alchemy/Stack";

import * as Axiom from "@alchemy.run/axiom";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Drizzle from "@alchemy.run/drizzle";
import * as GitHub from "@alchemy.run/github";
import * as Planetscale from "@alchemy.run/planetscale";
import * as PlanetscaleLogicalDb from "@macrograph/planetscale-logical-db";
import * as Alchemy from "alchemy";
import * as Command from "alchemy/Command";
import * as Output from "alchemy/Output";
import { Layer } from "effect";
import * as Effect from "effect/Effect";

import * as Dns from "./src/Dns.ts";
import { DurableObjectMigrationBundle } from "./src/editor/DurableObjectMigrationBundle.ts";
import { axiomConfigured, traceDatasetName } from "./src/Observability.ts";
import {
  DatabaseHyperdrive,
  DeploymentObjectsBucket,
  LegacyLogicalDatabase,
} from "./src/Storage.ts";
import { CloudWorker } from "./src/worker/CloudWorker.ts";
import CloudWorkerLayer, {
  IngressPublicOrigin,
  WebAssetsDirectory,
} from "./src/worker/CloudWorkerLayer.ts";
import { IngressWorker } from "./src/worker/IngressWorker.ts";
import IngressWorkerLayer from "./src/worker/IngressWorkerLayer.ts";
import WebsiteWorkerLayer, {
  WebsiteAssetsDirectory,
  WebsiteOAuthStateSecret,
  WebsiteWorker,
} from "./src/worker/WebsiteWorker.ts";

const logicalDatabaseProviders = PlanetscaleLogicalDb.providers() as Layer.Layer<
  PlanetscaleLogicalDb.Providers,
  never,
  StackServices
>;

export default Alchemy.Stack(
  "MacroGraph",
  {
    providers: Layer.mergeAll(
      Cloudflare.providers(),
      GitHub.providers(),
      ...(axiomConfigured() ? [Axiom.providers()] : []),
      Drizzle.providers(),
      Planetscale.providers(),
      logicalDatabaseProviders,
      DurableObjectMigrationBundle.providers(),
    ),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const ctx = yield* Alchemy.AlchemyContext;
    yield* DatabaseHyperdrive;
    yield* DeploymentObjectsBucket;
    if ((yield* Alchemy.Stage) === "production") {
      yield* Dns.records;
      yield* Dns.brendonovichDevRecordSet;
    }
    const legacyDatabase =
      !ctx.dev && process.env.PULL_REQUEST === undefined ? yield* LegacyLogicalDatabase : undefined;

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

    const websiteBuild = !ctx.dev
      ? yield* Command.Build("WebsiteBuild", {
          command: "pnpm run build",
          cwd: "../website",
          outdir: "dist",
          memo: false,
        })
      : undefined;

    const { cloudWorker, ingressWorker } = yield* Effect.gen(function* () {
      const ingressWorker = yield* IngressWorker.pipe(Alchemy.remote());
      const cloudWorker = yield* CloudWorker.pipe(Alchemy.remote()).pipe(
        Effect.provide(CloudWorkerLayer),
        Effect.provideService(WebAssetsDirectory, frontendBuild?.outdir),
        Effect.provideService(IngressPublicOrigin, ingressWorker.url),
      );
      return { cloudWorker, ingressWorker };
    }).pipe(Effect.provide(IngressWorkerLayer));

    const websiteOAuthStateSecret = yield* Alchemy.makeRandom("WebsiteOAuthStateSecret");
    const websiteWorker = yield* WebsiteWorker.pipe(Alchemy.remote()).pipe(
      Effect.provide(WebsiteWorkerLayer),
      Effect.provideService(WebsiteOAuthStateSecret, websiteOAuthStateSecret),
      Effect.provideService(WebsiteAssetsDirectory, websiteBuild?.outdir),
    );

    const github = yield* GitHub.GitHubEnv;
    if (github?.pr !== undefined) {
      yield* GitHub.Comment("CloudPreviewComment", {
        owner: github.owner,
        repository: github.repository,
        issueNumber: github.pr,
        body: Output.interpolate`
					## MacroGraph preview

					**Website:** ${websiteWorker.url}
					**Cloud:** ${websiteWorker.url}/cloud/
					**Ingress:** ${ingressWorker.url}

					Built from commit ${github.sha.slice(0, 7)}.
				`,
      });
    }

    return {
      publicWorkerUrl: cloudWorker.url,
      publicIngressUrl: ingressWorker.url,
      websiteWorkerUrl: websiteWorker.url,
    };
  }),
);
