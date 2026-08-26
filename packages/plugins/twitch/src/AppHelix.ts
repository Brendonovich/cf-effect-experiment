import { Context, Redacted } from "effect";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { HelixError, makeClient } from "./Helix.ts";

export class AppCredentials extends Context.Service<
  AppCredentials,
  {
    readonly clientId: string;
    readonly clientSecret: Redacted.Redacted;
  }
>()("@macrograph/plugin-twitch/Helix/AppCredentials") {}

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
    Effect.mapError(
      () =>
        new HelixError({ reason: "Twitch app authentication failed; verify the app credentials" }),
    ),
  );
  return yield* makeClient(yield* getToken, getToken.pipe(Effect.orDie), clientId);
});

export * as AppHelix from "./AppHelix.ts";
