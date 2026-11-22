import * as Cloudflare from "@alchemy.run/cloudflare";
import { TarballContentType } from "@macrograph/module-registry/Publish";
import * as Alchemy from "alchemy";
import { Context, Effect, Layer, Option } from "effect";

/** Immutable storage for published package tarballs. Storage failures are defects. */
export interface TarballStore {
  readonly put: (key: string, bytes: Uint8Array<ArrayBuffer>) => Effect.Effect<void>;
  readonly get: (key: string) => Effect.Effect<Option.Option<Uint8Array<ArrayBuffer>>>;
  readonly delete: (key: string) => Effect.Effect<void>;
}

export class Service extends Context.Service<Service, TarballStore>()(
  "macrograph/cloudflare/RegistryTarballStore",
) {}

export const RegistryTarballsBucket = Cloudflare.R2.Bucket("RegistryTarballs");

export const layerR2 = (bucketResource: Cloudflare.R2.Bucket) =>
  Layer.effect(Service)(
    Effect.gen(function* () {
      const bucket = yield* Cloudflare.R2.ReadWriteBucket(bucketResource);
      const runtimeContext = yield* Alchemy.RuntimeContext;
      const withRuntime = <A, E>(effect: Effect.Effect<A, E, Alchemy.RuntimeContext>) =>
        effect.pipe(Effect.provideService(Alchemy.RuntimeContext, runtimeContext), Effect.orDie);

      return {
        put: (key, bytes) =>
          withRuntime(
            bucket.put(key, bytes, {
              httpMetadata: {
                contentType: TarballContentType,
                cacheControl: "public, max-age=31536000, immutable",
              },
            }),
          ).pipe(Effect.asVoid),
        get: (key) =>
          withRuntime(
            Effect.gen(function* () {
              const object = yield* bucket.get(key);
              if (object === null) return Option.none();
              const buffer = yield* object.arrayBuffer();
              return Option.some(new Uint8Array(buffer));
            }),
          ),
        delete: (key) => withRuntime(bucket.delete(key)),
      } satisfies TarballStore;
    }),
  );

export const makeMemory = () => {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>();
  const store: TarballStore = {
    put: (key, bytes) => Effect.sync(() => void objects.set(key, bytes)),
    get: (key) => Effect.sync(() => Option.fromNullishOr(objects.get(key))),
    delete: (key) => Effect.sync(() => void objects.delete(key)),
  };
  return { store, objects };
};

export const layerMemory = Layer.sync(Service)(() => makeMemory().store);
