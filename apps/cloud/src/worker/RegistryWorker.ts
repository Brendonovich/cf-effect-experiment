import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import { Effect, Layer, Redacted } from "effect";
import { HttpRouter } from "effect/http";

import * as Database from "../database/Database.ts";
import { ObservabilityLayer } from "../Observability.ts";
import * as Registry from "../registry/Registry.ts";
import * as RegistryConfig from "../registry/RegistryConfig.ts";
import * as RegistryRoutes from "../registry/RegistryRoutes.ts";
import * as RegistrySigner from "../registry/RegistrySigner.ts";
import * as RegistryStore from "../registry/RegistryStore.ts";
import * as TarballStore from "../registry/TarballStore.ts";
import { DatabaseHyperdrive } from "../Storage.ts";

/** Serves the official module registry: the static protocol plus publish and admin APIs. */
export class RegistryWorker extends Cloudflare.Worker<RegistryWorker, {}>()("RegistryWorker") {}

const plainEnvironment = [
  "REGISTRY_ADMINS",
  "REGISTRY_SEED_PUBLISHERS",
  "REGISTRY_PUBLIC_ORIGIN",
  "REGISTRY_SIGNING_PUBLIC_KEY",
  "REGISTRY_SIGNING_KEY_ID",
];

export default Layer.unwrap(
  Effect.gen(function* () {
    const { stage } = yield* Alchemy.Stack;
    const databaseResource = yield* DatabaseHyperdrive;
    const tarballsResource = yield* TarballStore.RegistryTarballsBucket;
    const signingKey = process.env.REGISTRY_SIGNING_PRIVATE_KEY || undefined;
    const environment = Object.fromEntries(
      plainEnvironment.flatMap((name) => {
        const value = process.env[name] || undefined;
        return value === undefined ? [] : [[name, value] as const];
      }),
    );

    return RegistryWorker.make(
      {
        ...(stage === "production" ? { domain: "registry.macrograph.app" } : {}),
        main: import.meta.url,
        env: {
          ...environment,
          ...(signingKey === undefined
            ? {}
            : { REGISTRY_SIGNING_PRIVATE_KEY: Redacted.make(signingKey) }),
        },
        dev: { port: 1340, strictPort: true },
      },
      Effect.gen(function* () {
        const app = yield* RegistryRoutes.layer.pipe(
          Layer.provide(Registry.layer),
          Layer.provide([
            RegistryConfig.layerConfig,
            RegistrySigner.layerConfig,
            RegistryStore.layerDrizzle.pipe(Layer.provide(Database.layer(databaseResource))),
            TarballStore.layerR2(tarballsResource),
          ]),
          HttpRouter.toHttpEffect,
        );
        return { fetch: app };
      }).pipe(
        Effect.provide(Alchemy.RuntimeContext.phantom),
        Effect.provide(Cloudflare.Hyperdrive.ConnectBinding),
        Effect.provide(Cloudflare.R2.ReadWriteBucketBinding),
        Effect.provide(ObservabilityLayer),
      ),
    );
  }),
);
