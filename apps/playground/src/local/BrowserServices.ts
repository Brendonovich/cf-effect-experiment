import { BrowserSocket } from "@effect/platform-browser";
import { Crypto, Effect, Layer, PlatformError } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

const cryptoLayer = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => globalThis.crypto.getRandomValues(new Uint8Array(size)),
    digest: (algorithm, data) =>
      Effect.tryPromise({
        try: async () =>
          new Uint8Array(
            await globalThis.crypto.subtle.digest(algorithm, Uint8Array.from(data).buffer),
          ),
        catch: (cause) =>
          PlatformError.systemError({
            module: "BrowserCrypto",
            method: "digest",
            _tag: "Unknown",
            description: "Web Crypto digest failed",
            cause,
          }),
      }),
  }),
);

export const browserServices = Layer.mergeAll(
  FetchHttpClient.layer,
  BrowserSocket.layerWebSocketConstructor,
  cryptoLayer,
);
