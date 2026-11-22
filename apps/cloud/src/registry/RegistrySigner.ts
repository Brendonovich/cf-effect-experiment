import type { Protocol } from "@macrograph/module-registry/Protocol";

import { Signing } from "@macrograph/module-registry/Signing";
import { Config, Context, Effect, Layer, Option, Redacted } from "effect";

import { RegistryUnavailable } from "./Errors.ts";

export interface KeyMaterial {
  readonly keyId: string;
  /** Base64 raw Ed25519 public key. */
  readonly publicKey: string;
  /** Base64 PKCS#8 Ed25519 private key. */
  readonly privateKey: Redacted.Redacted<string>;
}

export interface Signer {
  /** The key published in `/.well-known/macrograph-registry.json`. */
  readonly key: Effect.Effect<Protocol.SigningKey, RegistryUnavailable>;
  readonly sign: (
    record: Protocol.SignedRecord,
  ) => Effect.Effect<Protocol.Signature, RegistryUnavailable>;
}

export class Service extends Context.Service<Service, Signer>()(
  "macrograph/cloudflare/RegistrySigner",
) {}

const unavailable = (message: string) => new RegistryUnavailable({ message });

const probe: Protocol.SignedRecord = {
  namespace: "registry.invalid",
  publisher: "probe",
  name: "probe",
  version: "0.0.0",
  api: 1,
  integrity: "sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
  trust: "untrusted",
  status: "active",
};

/** Builds a signer, checking once (lazily) that the private key matches the public key. */
export const make = (
  material: Effect.Effect<KeyMaterial, RegistryUnavailable>,
): Effect.Effect<Signer> =>
  Effect.gen(function* () {
    const loaded = yield* Effect.cached(
      Effect.gen(function* () {
        const { keyId, publicKey, privateKey } = yield* material;
        const signingKey = yield* Signing.importPrivateKey(Redacted.value(privateKey)).pipe(
          Effect.mapError(() =>
            unavailable("The registry signing key is not a PKCS#8 Ed25519 key"),
          ),
        );
        const key: Protocol.SigningKey = { id: keyId, algorithm: "Ed25519", publicKey };
        const signature = yield* Signing.sign(signingKey, probe).pipe(
          Effect.mapError(() => unavailable("The registry signing key cannot sign")),
        );
        yield* Signing.verifyRelease([key], probe, { keyId, value: signature }).pipe(
          Effect.mapError(() =>
            unavailable("The registry signing key does not match its public key"),
          ),
        );
        return { key, signingKey };
      }),
    );
    return {
      key: Effect.map(loaded, ({ key }) => key),
      sign: (record) =>
        Effect.gen(function* () {
          const { key, signingKey } = yield* loaded;
          const value = yield* Signing.sign(signingKey, record).pipe(
            Effect.mapError(() => unavailable("Signing the release record failed")),
          );
          return { keyId: key.id, value };
        }),
    };
  });

export const layer = (material: KeyMaterial) =>
  Layer.effect(Service)(make(Effect.succeed(material)));

/**
 * Reads `REGISTRY_SIGNING_PRIVATE_KEY` (PKCS#8, base64), `REGISTRY_SIGNING_PUBLIC_KEY` (raw,
 * base64) and `REGISTRY_SIGNING_KEY_ID`. Missing keys only fail the requests that need them.
 */
export const layerConfig = Layer.effect(Service)(
  make(
    Effect.gen(function* () {
      const privateKey = yield* Config.option(Config.Redacted("REGISTRY_SIGNING_PRIVATE_KEY"));
      const publicKey = yield* Config.option(Config.String("REGISTRY_SIGNING_PUBLIC_KEY"));
      const keyId = yield* Config.String("REGISTRY_SIGNING_KEY_ID").pipe(
        Config.withDefault("macrograph-1"),
      );
      if (Option.isNone(privateKey) || Option.isNone(publicKey))
        return yield* unavailable("The registry signing key is not configured");
      return { keyId, publicKey: publicKey.value, privateKey: privateKey.value };
    }).pipe(
      Effect.catchTag("ConfigError", () =>
        Effect.fail(unavailable("The registry signing key configuration is invalid")),
      ),
    ),
  ),
);
