import { Context, Data, Option, Redacted, Ref } from "effect";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as S from "effect/Schema";
import {
  Headers,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/unstable/httpapi";

export const DEFAULT_CLIENT_ID = "ldbp0fkq9yalf2lzsi146i0cip8y59";

export class HelixError extends S.TaggedErrorClass<HelixError>()("HelixError", {
  reason: S.String,
  status: S.optional(S.Number),
  body: S.optional(S.String),
}) {}

export class AppCredentials extends Context.Service<
  AppCredentials,
  {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted;
  }
>()("@macrograph/plugin-twitch/Helix/AppCredentials") {}

export const fromHttpClientError = Effect.fnUntraced(function* (
  error: HttpClientError.HttpClientError,
) {
  const response = error.response;
  const body =
    response === undefined
      ? undefined
      : yield* response.text.pipe(Effect.catch(() => Effect.succeed(undefined)));
  return yield* new HelixError({
    reason: error.message,
    ...(response === undefined ? {} : { status: response.status }),
    ...(body === undefined || body.length === 0 ? {} : { body }),
  });
});

export namespace Api {
  class ChatGroup extends HttpApiGroup.make("chat").add(
    HttpApiEndpoint.post("sendMessage", "/chat/messages"),
    // .setPayload(SendChatMessagePayload)
    // .addSuccess(ChatMessageResponse),
  ) {}

  const EventSubSubscription = S.Struct({
    id: S.String,
    type: S.String,
    version: S.String,
    status: S.String,
    condition: S.Record(S.String, S.String),
    transport: S.Union([
      S.Struct({ method: S.Literal("webhook"), callback: S.String }),
      S.Struct({ method: S.Literal("websocket"), session_id: S.String }),
    ]),
    created_at: S.DateFromString,
    cost: S.Int,
  });

  export const EventSubTransportWebhook = S.Struct({
    method: S.Literal("webhook"),
    callback: S.String,
    secret: S.String,
  });

  export const EventSubTransportWebsocket = S.Struct({
    method: S.Literal("websocket"),
    session_id: S.String,
  });

  export const EventSubTransport = S.Union([EventSubTransportWebhook, EventSubTransportWebsocket]);

  class EventSubGroup extends HttpApiGroup.make("eventsub").add(
    HttpApiEndpoint.get("listSubscriptions", "/eventsub/subscriptions", {
      query: S.Struct({
        status: S.optional(S.String),
        type: S.optional(S.String),
        user_id: S.optional(S.String),
        subscription_id: S.optional(S.String),
        after: S.optional(S.String),
      }),
      success: S.Struct({
        data: S.Array(EventSubSubscription),
        total: S.Int,
        total_cost: S.Int,
        max_total_cost: S.Int,
        // pagination: S.optional(Pagination),
      }),
    }),
    HttpApiEndpoint.delete("deleteSubscription", "/eventsub/subscriptions", {
      query: S.Struct({ id: S.String }),
    }),
    HttpApiEndpoint.post("createSubscription", "/eventsub/subscriptions", {
      payload: S.Struct({
        type: S.String,
        version: S.String,
        condition: S.Any,
        transport: EventSubTransport,
      }),
      success: S.Struct({ data: S.Tuple([S.Struct({ id: S.String })]) }).pipe(
        HttpApiSchema.status(202),
      ),
    }),
  ) {}

  export class HelixApi extends HttpApi.make("HELIX")
    .prefix("/helix")
    .annotate(OpenApi.Description, "Twitch Helix API for interacting with Twitch platform features")
    .annotate(OpenApi.Summary, "Twitch Helix API")
    .annotate(OpenApi.License, {
      name: "MIT",
      url: "https://opensource.org/licenses/MIT",
    })
    .annotate(OpenApi.Servers, [{ url: "https://api.twitch.tv/helix" }])
    .add(ChatGroup)
    .add(EventSubGroup) {}
}

class RetryRequest extends Data.TaggedError("RetryRequest")<{
  cause: HttpClientError.HttpClientError;
}> {}

const refreshCredentialsRetry = (refresh: Effect.Effect<void>) => {
  return (httpClient: HttpClient.HttpClient) =>
    httpClient.pipe(
      HttpClient.filterStatusOk,
      HttpClient.catchTag("HttpClientError", (e) =>
        Effect.gen(function* () {
          if (e.response?.status === 401) {
            yield* refresh;
            return yield* new RetryRequest({ cause: e });
          }
          return yield* Effect.fail(e);
        }),
      ),
      HttpClient.retry({
        times: 1,
        while: (e) => e._tag === "RetryRequest",
      }),
      HttpClient.catchTag("RetryRequest", (e) => Effect.fail(e.cause)),
    );
};

export const makeClient = (
  token: string,
  refreshCredential: Effect.Effect<string>,
  clientId = DEFAULT_CLIENT_ID,
) =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const tokenRef = yield* Ref.make(token);

    return yield* HttpApiClient.makeWith(Api.HelixApi, {
      baseUrl: "https://api.twitch.tv/helix",
      httpClient: httpClient.pipe(
        HttpClient.mapRequest((req) => ({
          ...req,
          headers: Headers.fromInput({
            Authorization: pipe(req.headers, Headers.get("authorization"), Option.getOrUndefined),
            "Client-Id": clientId,
            "Content-Type": "application/json",
          }),
        })),
        HttpClient.mapRequest((request) =>
          HttpClientRequest.bearerToken(request, Ref.getUnsafe(tokenRef)),
        ),
        refreshCredentialsRetry(
          refreshCredential.pipe(Effect.flatMap((newToken) => Ref.set(tokenRef, newToken))),
        ),
      ),
    });
  });

const AppAccessTokenResponse = S.Struct({ access_token: S.String });

export const makeAppClient = Effect.gen(function* () {
  const { clientId, clientSecret } = yield* AppCredentials;
  const httpClient = yield* HttpClient.HttpClient;
  const getToken = HttpClientRequest.post("https://id.twitch.tv/oauth2/token").pipe(
    HttpClientRequest.bodyUrlParams({
      client_id: clientId,
      client_secret: Redacted.value(clientSecret),
      grant_type: "client_credentials",
    }),
    HttpClient.filterStatusOk(httpClient).execute,
    Effect.flatMap(HttpClientResponse.schemaBodyJson(AppAccessTokenResponse)),
    Effect.map((response) => response.access_token),
    Effect.mapError((cause) => new HelixError({ reason: String(cause) })),
  );
  return yield* makeClient(yield* getToken, getToken.pipe(Effect.orDie), clientId);
});

export * as Helix from "./Helix.ts";
