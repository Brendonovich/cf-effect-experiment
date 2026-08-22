import * as BrowserHttpClient from "@effect/platform-browser/BrowserHttpClient";
import { Authentication, CloudApi } from "@macrograph/cloud-api";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { HttpApiClient, HttpApiMiddleware } from "effect/unstable/httpapi";

export const makeApiClient = (sessionId: string, publicRuntimeOrigin: string) => {
  const authentication = HttpApiMiddleware.layerClient(Authentication, ({ next, request }) =>
    next(HttpClientRequest.bearerToken(request, sessionId)),
  );

  return Effect.runSync(
    HttpApiClient.make(CloudApi, {
      baseUrl: location.origin,
      transformClient: HttpClient.mapRequest(
        HttpClientRequest.setHeader("x-macrograph-public-origin", publicRuntimeOrigin),
      ),
    }).pipe(Effect.provide(authentication), Effect.provide(BrowserHttpClient.layerFetch)),
  );
};

export type ApiClient = ReturnType<typeof makeApiClient>;
export type TeamsApiClient = ApiClient["teams"];
export type ProjectsApiClient = ApiClient["projects"];
export type RevisionsApiClient = ApiClient["revisions"];
export type ExecutionsApiClient = ApiClient["executions"];
export type IngressEventsApiClient = ApiClient["ingressEvents"];

export const runApi = <A, E>(effect: Effect.Effect<A, E>): Promise<A | undefined> =>
  Effect.runPromise(Effect.catchCause(effect, () => Effect.succeed(undefined)));

export const runApiResult = <A, E>(effect: Effect.Effect<A, E>): Promise<boolean> =>
  Effect.runPromise(
    effect.pipe(
      Effect.as(true),
      Effect.catchCause(() => Effect.succeed(false)),
    ),
  );
