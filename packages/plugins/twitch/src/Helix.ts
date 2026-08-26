import { Data, Option, Ref } from "effect";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as S from "effect/Schema";
import { Headers, HttpClient, HttpClientError, HttpClientRequest } from "effect/unstable/http";
import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/unstable/httpapi";

export const DEFAULT_CLIENT_ID = "ldbp0fkq9yalf2lzsi146i0cip8y59";

export class HelixError extends S.TaggedError<HelixError>()("HelixError", {
  reason: S.String,
  status: S.optional(S.Number),
  rateLimit: S.optional(S.Number),
  rateLimitRemaining: S.optional(S.Number),
  rateLimitReset: S.optional(S.Number),
}) {}

const headerNumber = (value: string | undefined) => {
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

export const fromHttpClientError = Effect.fnUntraced(function* (
  error: HttpClientError.HttpClientError,
) {
  const response = error.response;
  const rateLimit = headerNumber(response?.headers["ratelimit-limit"]);
  const rateLimitRemaining = headerNumber(response?.headers["ratelimit-remaining"]);
  const rateLimitReset = headerNumber(response?.headers["ratelimit-reset"]);
  return yield* new HelixError({
    reason:
      response?.status === 401
        ? "Twitch rejected the credential; reconnect the selected account"
        : response?.status === 403
          ? "The selected Twitch account lacks a required scope or channel role"
          : "Twitch request could not be completed",
    ...(response === undefined ? {} : { status: response.status }),
    ...(rateLimit === undefined ? {} : { rateLimit }),
    ...(rateLimitRemaining === undefined ? {} : { rateLimitRemaining }),
    ...(rateLimitReset === undefined ? {} : { rateLimitReset }),
  });
});

export namespace Api {
  const ChatSettings = S.Struct({
    emote_mode: S.Boolean,
    follower_mode: S.Boolean,
    slow_mode: S.Boolean,
    subscriber_mode: S.Boolean,
  });
  class ChatGroup extends HttpApiGroup.make("chat")
    .add(
      HttpApiEndpoint.post("sendMessage", "/chat/messages", {
        payload: S.Struct({
          broadcaster_id: S.String,
          sender_id: S.String,
          message: S.String,
          reply_parent_message_id: S.optional(S.String),
        }),
        success: S.Struct({
          data: S.Array(
            S.Struct({
              message_id: S.String,
              is_sent: S.Boolean,
              drop_reason: S.optional(S.Struct({ code: S.String, message: S.String })),
            }),
          ),
        }),
      }),
    )
    .add(
      HttpApiEndpoint.get("getSettings", "/chat/settings", {
        query: S.Struct({ broadcaster_id: S.String }),
        success: S.Struct({ data: S.Array(ChatSettings) }),
      }),
    )
    .add(
      HttpApiEndpoint.patch("updateSettings", "/chat/settings", {
        query: S.Struct({ broadcaster_id: S.String, moderator_id: S.String }),
        payload: S.Struct({
          emote_mode: S.optional(S.Boolean),
          follower_mode: S.optional(S.Boolean),
          slow_mode: S.optional(S.Boolean),
          subscriber_mode: S.optional(S.Boolean),
        }),
        success: S.Struct({ data: S.Array(ChatSettings) }),
      }),
    ) {}

  const ChannelInformation = S.Struct({
    broadcaster_id: S.String,
    broadcaster_login: S.String,
    broadcaster_name: S.String,
    broadcaster_language: S.String,
    game_id: S.String,
    game_name: S.String,
    title: S.String,
  });
  class ChannelsGroup extends HttpApiGroup.make("channels")
    .add(
      HttpApiEndpoint.get("getInformation", "/channels", {
        query: S.Struct({ broadcaster_id: S.String }),
        success: S.Struct({ data: S.Array(ChannelInformation) }),
      }),
    )
    .add(
      HttpApiEndpoint.patch("modifyInformation", "/channels", {
        query: S.Struct({ broadcaster_id: S.String }),
        payload: S.Struct({
          game_id: S.optional(S.String),
          broadcaster_language: S.optional(S.String),
          title: S.optional(S.String),
        }),
      }),
    ) {}

  class StreamsGroup extends HttpApiGroup.make("streams").add(
    HttpApiEndpoint.get("getStreams", "/streams", {
      query: S.Struct({ user_id: S.String }),
      success: S.Struct({
        data: S.Array(
          S.Struct({
            id: S.String,
            user_id: S.String,
            game_name: S.optional(S.String),
            title: S.String,
            viewer_count: S.Int,
          }),
        ),
      }),
    }),
  ) {}

  class ClipsGroup extends HttpApiGroup.make("clips").add(
    HttpApiEndpoint.post("createClip", "/clips", {
      query: S.Struct({ broadcaster_id: S.String }),
      success: S.Struct({ data: S.Array(S.Struct({ id: S.String, edit_url: S.String })) }).pipe(
        HttpApiSchema.status(202),
      ),
    }),
  ) {}

  class PollsGroup extends HttpApiGroup.make("polls")
    .add(
      HttpApiEndpoint.post("createPoll", "/polls", {
        payload: S.Struct({
          broadcaster_id: S.String,
          title: S.String,
          choices: S.Array(S.Struct({ title: S.String })),
          duration: S.Int,
        }),
        success: S.Struct({ data: S.Array(S.Struct({ id: S.String })) }),
      }),
    )
    .add(
      HttpApiEndpoint.patch("endPoll", "/polls", {
        payload: S.Struct({ broadcaster_id: S.String, id: S.String, status: S.String }),
        success: S.Struct({ data: S.Array(S.Struct({ id: S.String })) }),
      }),
    ) {}

  class PredictionsGroup extends HttpApiGroup.make("predictions")
    .add(
      HttpApiEndpoint.post("createPrediction", "/predictions", {
        payload: S.Struct({
          broadcaster_id: S.String,
          title: S.String,
          outcomes: S.Array(S.Struct({ title: S.String })),
          prediction_window: S.Int,
        }),
        success: S.Struct({ data: S.Array(S.Struct({ id: S.String })) }),
      }),
    )
    .add(
      HttpApiEndpoint.patch("endPrediction", "/predictions", {
        payload: S.Struct({
          broadcaster_id: S.String,
          id: S.String,
          status: S.String,
          winning_outcome_id: S.optional(S.String),
        }),
        success: S.Struct({ data: S.Array(S.Struct({ id: S.String })) }),
      }),
    ) {}

  class UsersGroup extends HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("getUsers", "/users", {
      query: S.Struct({ id: S.optional(S.String), login: S.optional(S.String) }),
      success: S.Struct({
        data: S.Array(
          S.Struct({
            id: S.String,
            display_name: S.String,
            broadcaster_type: S.String,
            description: S.String,
          }),
        ),
      }),
    }),
  ) {}

  class FollowersGroup extends HttpApiGroup.make("followers").add(
    HttpApiEndpoint.get("getFollowers", "/channels/followers", {
      query: S.Struct({ broadcaster_id: S.String }),
      success: S.Struct({ total: S.Int }),
    }),
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
        pagination: S.optional(S.Struct({ cursor: S.optional(S.String) })),
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
    .add(ChannelsGroup)
    .add(StreamsGroup)
    .add(ClipsGroup)
    .add(PollsGroup)
    .add(PredictionsGroup)
    .add(UsersGroup)
    .add(FollowersGroup)
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
        // Twitch's CORS policy rejects Effect's b3 and traceparent headers.
        HttpClient.transformResponse(
          Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        ),
      ),
    });
  });

export * as Helix from "./Helix.ts";
