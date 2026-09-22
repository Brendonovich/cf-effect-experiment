import * as BrowserHttpClient from "@effect/platform-browser/BrowserHttpClient";
import { CloudApi } from "@macrograph/cloud-api";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";

import { signInUrl } from "./authRedirect";

export const publicWorkerOrigin = () =>
  new URL(
    import.meta.env.VITE_PUBLIC_WORKER_ORIGIN ?? import.meta.env.VITE_WORKER_URL ?? location.origin,
  ).origin;

export const makeApiClient = (publicWorkerOrigin: string, isSigningOut: () => boolean) => {
  const transformClient = (client: HttpClient.HttpClient) =>
    client.pipe(
      HttpClient.mapRequest(
        HttpClientRequest.setHeader("x-macrograph-public-origin", publicWorkerOrigin),
      ),
      HttpClient.transformResponse(
        Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
      ),
      HttpClient.tap((response) =>
        Effect.sync(() => {
          if (
            response.status === 401 &&
            // Let coordinated logout finish its website request before navigating away.
            !isSigningOut() &&
            location.pathname.replace(/\/+$/, "").toLowerCase() !==
              `${import.meta.env.BASE_URL}sign-in`.toLowerCase()
          ) {
            // Restart authentication without retaining any workspace state from the expired session.
            window.location.replace(
              signInUrl(
                `${location.pathname}${location.search}${location.hash}`,
                import.meta.env.BASE_URL,
              ),
            );
          }
        }),
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
