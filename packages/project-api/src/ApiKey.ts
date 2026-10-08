import { Effect } from "effect";

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Hashes an API key for storage and lookup; only the hash is ever persisted. */
export const hash = (key: string) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))).pipe(
    Effect.map((digest) => toHex(new Uint8Array(digest))),
  );

/** Creates a new `mg_` API key and the hash to store for it. */
export const generate = Effect.gen(function* () {
  const key = `mg_${toHex(crypto.getRandomValues(new Uint8Array(32)))}`;
  return { key, keyHash: yield* hash(key) };
});

/** Reads the key from an `Authorization: Bearer <key>` header value. */
export const fromAuthorization = (authorization: string | undefined) =>
  /^Bearer ([^\s]+)$/i.exec(authorization ?? "")?.[1];

export * as ApiKey from "./ApiKey.ts";
