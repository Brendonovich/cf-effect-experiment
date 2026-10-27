import { Effect, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";

import type { Protocol } from "./Protocol.ts";

import { CanonicalJson } from "./CanonicalJson.ts";

const algorithm = { name: "Ed25519" } as const;

export class CryptoError extends Schema.TaggedError<CryptoError>()("RegistryCryptoError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {}

export class SignatureInvalid extends Schema.TaggedError<SignatureInvalid>()(
  "RegistrySignatureInvalid",
  { keyId: Schema.String, message: Schema.String },
) {}

export interface KeyPair {
  /** Base64 raw 32-byte public key, as published in registry metadata. */
  readonly publicKey: string;
  /** Base64 PKCS#8 private key. */
  readonly privateKey: string;
}

const subtle = <A>(operation: string, run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new CryptoError({ operation, cause }) });

const decodeBase64 = (operation: string, value: string) =>
  Result.match(Base64.decode(value), {
    onFailure: (cause) => Effect.fail(new CryptoError({ operation, cause })),
    onSuccess: (bytes) => Effect.succeed(new Uint8Array(bytes)),
  });

export const generateKeyPair: Effect.Effect<KeyPair, CryptoError> = Effect.gen(function* () {
  const pair = yield* subtle("generateKey", () =>
    crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]),
  );
  const publicKey = yield* subtle("exportKey", () =>
    crypto.subtle.exportKey("raw", pair.publicKey),
  );
  const privateKey = yield* subtle("exportKey", () =>
    crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  return {
    publicKey: Base64.encode(new Uint8Array(publicKey)),
    privateKey: Base64.encode(new Uint8Array(privateKey)),
  };
});

export const importPublicKey = (publicKey: string): Effect.Effect<CryptoKey, CryptoError> =>
  Effect.flatMap(decodeBase64("importKey", publicKey), (bytes) =>
    subtle("importKey", () => crypto.subtle.importKey("raw", bytes, algorithm, true, ["verify"])),
  );

export const importPrivateKey = (privateKey: string): Effect.Effect<CryptoKey, CryptoError> =>
  Effect.flatMap(decodeBase64("importKey", privateKey), (bytes) =>
    subtle("importKey", () => crypto.subtle.importKey("pkcs8", bytes, algorithm, false, ["sign"])),
  );

/** Signs the canonical JSON of a release record and returns the base64 signature. */
export const sign = (
  privateKey: CryptoKey,
  record: Protocol.SignedRecord,
): Effect.Effect<string, CryptoError> =>
  subtle("sign", () =>
    crypto.subtle.sign(algorithm, privateKey, CanonicalJson.encode(record)),
  ).pipe(Effect.map((signature) => Base64.encode(new Uint8Array(signature))));

export const verify = (
  publicKey: CryptoKey,
  record: Protocol.SignedRecord,
  signature: string,
): Effect.Effect<boolean, CryptoError> =>
  Result.match(Base64.decode(signature), {
    onFailure: () => Effect.succeed(false),
    onSuccess: (bytes) =>
      subtle("verify", () =>
        crypto.subtle.verify(
          algorithm,
          publicKey,
          new Uint8Array(bytes),
          CanonicalJson.encode(record),
        ),
      ),
  });

/** Verifies a release's signature against the registry's pinned signing keys. */
export const verifyRelease = (
  keys: ReadonlyArray<Protocol.SigningKey>,
  record: Protocol.SignedRecord,
  signature: Protocol.Signature,
): Effect.Effect<void, SignatureInvalid | CryptoError> =>
  Effect.gen(function* () {
    const key = keys.find((candidate) => candidate.id === signature.keyId);
    if (key === undefined)
      return yield* new SignatureInvalid({
        keyId: signature.keyId,
        message: "Unknown signing key",
      });
    const publicKey = yield* importPublicKey(key.publicKey);
    const valid = yield* verify(publicKey, record, signature.value);
    if (!valid)
      return yield* new SignatureInvalid({
        keyId: signature.keyId,
        message: "Signature does not match the release record",
      });
  });

export * as Signing from "./Signing.ts";
