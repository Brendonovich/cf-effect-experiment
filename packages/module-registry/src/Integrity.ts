import { Effect, Schema } from "effect";
import { Base64 } from "effect/encoding";

const pattern = /^sha256-[A-Za-z0-9+/]{43}=$/;

export const isIntegrity = (value: string) => pattern.test(value);

/** A Subresource Integrity style SHA-256 digest, e.g. `sha256-<base64>`. */
export const Hash = Schema.String.check(
  Schema.makeFilter((value: string) => isIntegrity(value) || "Expected a sha256- integrity hash"),
);
export type Hash = typeof Hash.Type;

export class IntegrityMismatch extends Schema.TaggedError<IntegrityMismatch>()(
  "IntegrityMismatch",
  { expected: Schema.String, actual: Schema.String },
) {}

export class DigestError extends Schema.TaggedError<DigestError>()("DigestError", {
  cause: Schema.Defect(),
}) {}

export const compute = (bytes: Uint8Array<ArrayBuffer>): Effect.Effect<Hash, DigestError> =>
  Effect.tryPromise({
    try: () => crypto.subtle.digest("SHA-256", bytes),
    catch: (cause) => new DigestError({ cause }),
  }).pipe(Effect.map((digest) => `sha256-${Base64.encode(new Uint8Array(digest))}`));

export const verify = (
  bytes: Uint8Array<ArrayBuffer>,
  expected: string,
): Effect.Effect<void, IntegrityMismatch | DigestError> =>
  Effect.flatMap(compute(bytes), (actual) =>
    actual === expected ? Effect.void : Effect.fail(new IntegrityMismatch({ expected, actual })),
  );

export * as Integrity from "./Integrity.ts";
