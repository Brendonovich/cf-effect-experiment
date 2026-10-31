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
import * as PublicHost from "./src/PublicHost.ts";
import { RegistryTarballsBucket } from "./src/registry/TarballStore.ts";
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
import RegistryWorkerLayer, { RegistryWorker } from "./src/worker/RegistryWorker.ts";
import WebsiteWorkerLayer, {
  WebsiteOAuthStateSecret,
  WebsiteSigningKey,
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
    yield* RegistryTarballsBucket;
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

    const registryWorker = yield* RegistryWorker.pipe(Alchemy.remote()).pipe(
      Effect.provide(RegistryWorkerLayer),
    );

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
    const websiteSigningKey = yield* Alchemy.KeyPair("WebsiteSigningKey", {
      algorithm: "rsa",
      modulusLength: 2048,
    });
    const websiteWorker = yield* WebsiteWorker.pipe(Alchemy.remote()).pipe(
      Effect.provide(WebsiteWorkerLayer),
      Effect.provideService(WebsiteOAuthStateSecret, websiteOAuthStateSecret),
      Effect.provideService(WebsiteSigningKey, websiteSigningKey.privateKey),
    );

    // The server-rendered website (`apps/website`, Solid start mode). It owns the stage's hostname;
    // the API and Cloud claim their paths with Worker Routes there, and elsewhere it forwards them
    // over these bindings (see `apps/website/src/worker.ts`).
    const stage = yield* Alchemy.Stage;
    const publicHost = PublicHost.forStage(stage);
    const website = yield* Cloudflare.Website.Vite("Website", {
      rootDir: "../website",
      main: "src/worker.ts",
      env: {
        API: websiteWorker,
        CLOUD: cloudWorker,
        // Previews let only allowed accounts in; WebsiteWorker makes the decision.
        ...(PublicHost.isPreviewStage(stage) ? { PREVIEW_GATE: "1" } : {}),
      },
      // The app compiles workspace packages from source, so their changes must rebuild it too.
      memo: {
        include: ["**/*", "../../packages/*/src/**", "../../packages/*/package.json"],
        lockfile: true,
      },
      ...(publicHost === undefined
        ? // Explicitly detach: omitting `domain` would leave a previously attached one in place.
          { domain: null }
        : { domain: { name: publicHost, aliases: [...PublicHost.legacyBrowserHosts] } }),
    });

    const github = yield* GitHub.GitHubEnv;
    if (github?.pr !== undefined) {
      yield* GitHub.Comment("CloudPreviewComment", {
        owner: github.owner,
        repository: github.repository,
        issueNumber: github.pr,
        body: Output.interpolate`
					## MacroGraph preview

					**Website:** ${website.url}

					Built from commit ${github.sha.slice(0, 7)}.
				`,
      });
    }

    return {
      publicWorkerUrl: cloudWorker.url,
      publicIngressUrl: ingressWorker.url,
      websiteUrl: website.url,
      websiteWorkerUrl: websiteWorker.url,
      registryWorkerUrl: registryWorker.url,
    };
  }),
);
