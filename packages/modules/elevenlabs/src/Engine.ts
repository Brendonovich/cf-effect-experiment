import { Effect, Encoding, Layer, Schema } from "effect";
import { FetchHttpClient, Headers, HttpClient, HttpClientRequest } from "effect/unstable/http";

import {
  ClientRpcs,
  ElevenLabsEngine,
  RequestFailure,
  RuntimeRpcs,
  SpeechOptions,
} from "./Definition.ts";

export const layer = ElevenLabsEngine.toLayer((mg) =>
  Effect.gen(function* () {
    const client = HttpClient.withScope(yield* HttpClient.HttpClient);

    return ElevenLabsEngine.of({
      resources: Layer.empty,
      rpcs: RuntimeRpcs.toLayer({
        ElevenLabsTTS: Effect.fnUntraced(
          function* ({ text, modelId, voiceId, body }) {
            if (
              text.trim().length === 0 ||
              modelId.trim().length === 0 ||
              !/^[A-Za-z0-9_-]{1,128}$/.test(voiceId)
            )
              return yield* new RequestFailure({ reason: "Invalid input" });
            const options = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SpeechOptions))(
              body,
              { onExcessProperty: "error" },
            ).pipe(Effect.mapError(() => new RequestFailure({ reason: "Invalid input" })));
            const { apiKey } = yield* mg.storage.get;
            if (apiKey === null || apiKey.trim().length === 0)
              return yield* new RequestFailure({ reason: "API key is not configured" });
            const request = yield* HttpClientRequest.post(
              `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            ).pipe(
              HttpClientRequest.setUrlParam("output_format", "mp3_44100_128"),
              HttpClientRequest.setHeader("xi-api-key", apiKey),
              HttpClientRequest.accept("audio/mpeg"),
              HttpClientRequest.bodyJson({ ...options, text, model_id: modelId.trim() }),
              Effect.mapError(() => new RequestFailure({ reason: "Invalid input" })),
            );
            const response = yield* client
              .execute(request)
              .pipe(Effect.mapError(() => new RequestFailure({ reason: "Request failed" })));
            if (response.status < 200 || response.status >= 300)
              return yield* new RequestFailure({
                reason: "Provider rejected request",
                status: response.status,
              });
            const mime = response.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
            if (mime !== "audio/mpeg")
              return yield* new RequestFailure({ reason: "Invalid provider response" });
            const buffer = yield* response.arrayBuffer.pipe(
              Effect.mapError(() => new RequestFailure({ reason: "Invalid provider response" })),
            );
            if (buffer.byteLength === 0)
              return yield* new RequestFailure({ reason: "Invalid provider response" });
            return { audio: Encoding.encodeBase64(new Uint8Array(buffer)), mime };
          },
          (effect) =>
            effect.pipe(
              Effect.scoped,
              Effect.updateService(Headers.CurrentRedactedNames, (names) => [
                ...names,
                "xi-api-key",
              ]),
              // Never forward a credential through a provider redirect.
              Effect.provideService(FetchHttpClient.RequestInit, {
                redirect: "manual",
                credentials: "omit",
              }),
              Effect.timeoutOrElse({
                duration: "60 seconds",
                orElse: () => new RequestFailure({ reason: "Request timed out" }),
              }),
            ),
        ),
      }),
      client: {
        state: mg.storage.get.pipe(
          Effect.map(({ apiKey }) => ({ configured: apiKey !== null && apiKey.trim().length > 0 })),
        ),
        rpcs: ClientRpcs.toLayer({
          ElevenLabsUpdateKey: Effect.fnUntraced(function* ({ apiKey }) {
            const key = apiKey.trim();
            if (!/^[\x21-\x7e]{1,4096}$/.test(key))
              return yield* new RequestFailure({ reason: "Invalid input" });
            yield* mg.storage.set({ apiKey: key });
            yield* mg.client.refresh;
          }),
          ElevenLabsClearKey: Effect.fnUntraced(function* () {
            yield* mg.storage.set({ apiKey: null });
            yield* mg.client.refresh;
          }),
        }),
      },
    });
  }),
);

export default layer;
