import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, Headers, HttpClient, HttpClientRequest } from "effect/unstable/http";

import {
  ChatHistory,
  ClientRpcs,
  ImageModel,
  OpenAIEngine,
  RequestFailure,
  RuntimeRpcs,
} from "./Definition.ts";

const ChatResponse = Schema.Struct({
  choices: Schema.Array(Schema.Struct({ message: Schema.Struct({ content: Schema.String }) })),
});
const ImageResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      url: Schema.optionalKey(Schema.String),
      b64_json: Schema.optionalKey(Schema.String),
      revised_prompt: Schema.optionalKey(Schema.String),
    }),
  ),
});

export const layer = OpenAIEngine.toLayer((mg) =>
  Effect.gen(function* () {
    const client = HttpClient.withScope(yield* HttpClient.HttpClient);

    const requestJson = Effect.fnUntraced(
      function* (
        operation: "chat" | "image",
        path: "/v1/chat/completions" | "/v1/images/generations",
        body: unknown,
      ) {
        const { apiKey } = yield* mg.storage.get;
        if (apiKey === null || apiKey.trim().length === 0)
          return yield* new RequestFailure({ operation, reason: "API key is not configured" });
        const request = yield* HttpClientRequest.post(`https://api.openai.com${path}`).pipe(
          HttpClientRequest.setHeader("authorization", `Bearer ${apiKey}`),
          HttpClientRequest.acceptJson,
          HttpClientRequest.bodyJson(body),
          Effect.mapError(() => new RequestFailure({ operation, reason: "Invalid input" })),
        );
        const response = yield* client
          .execute(request)
          .pipe(Effect.mapError(() => new RequestFailure({ operation, reason: "Request failed" })));
        if (response.status < 200 || response.status >= 300)
          return yield* new RequestFailure({
            operation,
            reason: "Provider rejected request",
            status: response.status,
          });
        return yield* response.json.pipe(
          Effect.mapError(
            () => new RequestFailure({ operation, reason: "Invalid provider response" }),
          ),
        );
      },
      (effect, operation) =>
        effect.pipe(
          Effect.scoped,
          Effect.updateService(Headers.CurrentRedactedNames, (names) => [
            ...names,
            "authorization",
          ]),
          // Never forward a credential through a provider redirect.
          Effect.provideService(FetchHttpClient.RequestInit, {
            redirect: "manual",
            credentials: "omit",
          }),
          Effect.timeoutOrElse({
            duration: "60 seconds",
            orElse: () => new RequestFailure({ operation, reason: "Request timed out" }),
          }),
        ),
    );

    return OpenAIEngine.of({
      resources: Layer.empty,
      rpcs: RuntimeRpcs.toLayer({
        OpenAIChat: Effect.fnUntraced(function* ({ message, model, historyIn }) {
          if (message.trim().length === 0 || model.trim().length === 0)
            return yield* new RequestFailure({ operation: "chat", reason: "Invalid input" });
          const history = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ChatHistory))(
            historyIn,
            { onExcessProperty: "error" },
          ).pipe(
            Effect.mapError(
              () => new RequestFailure({ operation: "chat", reason: "Invalid input" }),
            ),
          );
          const messages = [...history, { role: "user" as const, content: message }];
          const json = yield* requestJson("chat", "/v1/chat/completions", {
            model: model.trim(),
            messages,
            stream: false,
          });
          const result = yield* Schema.decodeUnknownEffect(ChatResponse)(json).pipe(
            Effect.mapError(
              () => new RequestFailure({ operation: "chat", reason: "Invalid provider response" }),
            ),
          );
          const first = result.choices[0];
          if (first === undefined)
            return yield* new RequestFailure({
              operation: "chat",
              reason: "Invalid provider response",
            });
          return {
            response: first.message.content,
            historyOut: JSON.stringify([
              ...messages,
              { role: "assistant", content: first.message.content },
            ]),
          };
        }),
        OpenAIImage: Effect.fnUntraced(function* ({ prompt, model }) {
          if (prompt.trim().length === 0)
            return yield* new RequestFailure({ operation: "image", reason: "Invalid input" });
          const imageModel = yield* Schema.decodeUnknownEffect(ImageModel)(model.trim()).pipe(
            Effect.mapError(
              () => new RequestFailure({ operation: "image", reason: "Invalid input" }),
            ),
          );
          const legacy = imageModel === "dall-e-2" || imageModel === "dall-e-3";
          const json = yield* requestJson("image", "/v1/images/generations", {
            model: imageModel,
            prompt,
            n: 1,
            size: "1024x1024",
            ...(legacy ? { response_format: "url" } : { output_format: "png" }),
            ...(imageModel === "dall-e-3" ? { style: "vivid" } : {}),
          });
          const result = yield* Schema.decodeUnknownEffect(ImageResponse)(json).pipe(
            Effect.mapError(
              () => new RequestFailure({ operation: "image", reason: "Invalid provider response" }),
            ),
          );
          const first = result.data[0];
          if (first === undefined)
            return yield* new RequestFailure({
              operation: "image",
              reason: "Invalid provider response",
            });
          const imageUrl = first.url ?? "";
          const base64 = first.b64_json ?? "";
          if (legacy) {
            const validUrl = yield* Effect.try({
              try: () => {
                const url = new URL(imageUrl);
                return url.protocol === "https:" && url.username === "" && url.password === "";
              },
              catch: () =>
                new RequestFailure({ operation: "image", reason: "Invalid provider response" }),
            });
            if (!validUrl)
              return yield* new RequestFailure({
                operation: "image",
                reason: "Invalid provider response",
              });
          } else if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
            return yield* new RequestFailure({
              operation: "image",
              reason: "Invalid provider response",
            });
          }
          return {
            url: legacy ? imageUrl : null,
            base64: legacy ? null : base64,
            mime: "image/png",
            revised: first.revised_prompt ?? null,
          };
        }),
      }),
      client: {
        state: mg.storage.get.pipe(
          Effect.map(({ apiKey }) => ({ configured: apiKey !== null && apiKey.trim().length > 0 })),
        ),
        rpcs: ClientRpcs.toLayer({
          OpenAIUpdateKey: Effect.fnUntraced(function* ({ apiKey }) {
            const key = apiKey.trim();
            if (!/^[\x21-\x7e]{1,4096}$/.test(key))
              return yield* new RequestFailure({ operation: "settings", reason: "Invalid input" });
            yield* mg.storage.set({ apiKey: key });
            yield* mg.client.refresh;
          }),
          OpenAIClearKey: Effect.fnUntraced(function* () {
            yield* mg.storage.set({ apiKey: null });
            yield* mg.client.refresh;
          }),
        }),
      },
    });
  }),
);

export default layer;
