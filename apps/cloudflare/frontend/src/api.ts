import * as BrowserHttpClient from "@effect/platform-browser/BrowserHttpClient";
import { CloudApi } from "@macrograph/cloud-api";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";

export const makeApiClient = (publicWorkerOrigin: string) => {
  const transformClient = (client: HttpClient.HttpClient) =>
    client.pipe(
      HttpClient.mapRequest(
        HttpClientRequest.setHeader("x-macrograph-public-origin", publicWorkerOrigin),
      ),
      HttpClient.transformResponse(
        Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
      ),
    );

  return Effect.runSync(
    HttpApiClient.make(CloudApi, {
      baseUrl: location.origin,
      transformClient,
    }).pipe(Effect.provide(BrowserHttpClient.layerFetch)),
  );
};

export type ApiClient = ReturnType<typeof makeApiClient>;
export type TeamsApiClient = ApiClient["teams"];
export type ProjectsApiClient = ApiClient["projects"];
export type DeploymentsApiClient = ApiClient["deployments"];
export type ExecutionsApiClient = ApiClient["executions"];
export type EventsApiClient = ApiClient["events"];
export type CredentialsApiClient = ApiClient["credentials"];

export const runApi = <A, E>(effect: Effect.Effect<A, E>): Promise<A | undefined> =>
  Effect.runPromise(Effect.catchCause(effect, () => Effect.succeed(undefined)));

export const runApiResult = <A, E>(effect: Effect.Effect<A, E>): Promise<boolean> =>
  Effect.runPromise(
    effect.pipe(
      Effect.as(true),
      Effect.catchCause(() => Effect.succeed(false)),
    ),
  );
