import * as PlanetscaleLogicalDb from "@macrograph/planetscale-logical-db";
import * as Alchemy from "alchemy";
import * as Axiom from "alchemy/Axiom";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Command from "alchemy/Command";
import * as Drizzle from "alchemy/Drizzle";
import * as GitHub from "alchemy/GitHub";
import * as Output from "alchemy/Output";
import * as Planetscale from "alchemy/Planetscale";
import { Layer } from "effect";
import * as Effect from "effect/Effect";

import { DurableObjectMigrationBundle } from "./src/editor/DurableObjectMigrationBundle.ts";
import { axiomConfigured, traceDatasetName } from "./src/Observability.ts";
import {
  DatabaseHyperdrive,
  DeploymentObjectsBucket,
  LegacyLogicalDatabase,
} from "./src/Storage.ts";
import CloudWorkerLayer, {
  CloudWorker,
  CredentialOAuthStateSecret,
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
      ...(axiomConfigured() ? [Axiom.providers()] : []),
      Drizzle.providers(),
      GitHub.providers(),
      Planetscale.providers(),
      PlanetscaleLogicalDb.providers(),
      DurableObjectMigrationBundle.providers(),
    ),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const ctx = yield* Alchemy.AlchemyContext;
    const stage = yield* Alchemy.Stage;
    const github = yield* GitHub.GitHubEnv;
    const isPreview = /^pr-\d+$/.test(stage);
    const credentialOAuthStateSecret = yield* Alchemy.makeRandom("CredentialOAuthStateSecret");
    yield* DatabaseHyperdrive;
    yield* DeploymentObjectsBucket;
    if (stage === "production") yield* LegacyLogicalDatabase;

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
    const playgroundBuild = isPreview
      ? yield* Command.Build("PlaygroundBuild", {
          command: "pnpm run build",
          cwd: "../playground",
          outdir: "dist",
          memo: false,
        })
      : undefined;
    const playgroundWorker = playgroundBuild
      ? yield* Cloudflare.Worker("PlaygroundWorker", {
          assets: Output.map(playgroundBuild.outdir, (directory) => ({
            directory,
            htmlHandling: "auto-trailing-slash" as const,
            notFoundHandling: "single-page-application" as const,
          })),
        })
      : undefined;

    const { cloudWorker, ingressWorker } = yield* Effect.gen(function* () {
      const ingressWorker = yield* IngressWorker.pipe(Alchemy.remote());
      const cloudWorker = yield* CloudWorker.pipe(Alchemy.remote()).pipe(
        Effect.provide(CloudWorkerLayer),
        Effect.provideService(CredentialOAuthStateSecret, credentialOAuthStateSecret),
        Effect.provideService(WebAssetsDirectory, frontendBuild?.outdir),
        Effect.provideService(IngressPublicOrigin, ingressWorker.url),
      );
      return { cloudWorker, ingressWorker };
    }).pipe(Effect.provide(IngressWorkerLayer));
    if (github?.pr !== undefined && playgroundWorker !== undefined) {
      yield* GitHub.Comment("PreviewDeploymentComment", {
        owner: github.owner,
        repository: github.repository,
        issueNumber: github.pr,
        allowDelete: true,
        body: Output.interpolate`
					## MacroGraph previews

					- [Cloud](${cloudWorker.url})
					- [Playground](${playgroundWorker.url})

					Commit: \`${github.sha.slice(0, 7)}\`

					Cloud preview login uses manual device authorization.
				`,
      });
    }
    return {
      publicWorkerUrl: cloudWorker.url,
      publicIngressUrl: ingressWorker.url,
      ...(playgroundWorker === undefined ? {} : { playgroundUrl: playgroundWorker.url }),
    };
  }),
);
