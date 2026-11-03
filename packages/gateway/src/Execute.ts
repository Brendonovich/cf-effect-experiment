import { Data, Effect, type Schema } from "effect";
import { FetchHttpClient, Headers, HttpClient, HttpClientRequest } from "effect/http";

import type { Auth, Provider } from "./Provider.ts";
import type { PreparedRequest } from "./Tool.ts";

const maxResponseBytes = 1024 * 1024;

export class RequestError extends Data.TaggedError("GatewayRequestError")<{
  readonly message: string;
}> {}

/** The provider's answer, whatever its status. */
export interface Response {
  readonly status: number;
  readonly body: Schema.Json;
}

export const url = (provider: Provider, request: PreparedRequest) => {
  const base = new URL(provider.baseUrl);
  const target = /^https?:\/\//.test(request.path)
    ? new URL(request.path)
    : new URL(`${base.pathname.replace(/\/$/, "")}${request.path}`, base.origin);
  if (target.origin !== base.origin && !(provider.origins ?? []).includes(target.origin))
    return undefined;
  for (const [key, value] of Object.entries(request.query ?? {}))
    target.searchParams.set(key, String(value));
  return target;
};

/** Sends a prepared request as the account whose token is in `auth`. */
export const execute = (provider: Provider, request: PreparedRequest, auth: Auth) =>
  Effect.gen(function* () {
    const target = url(provider, request);
    if (target === undefined)
      return yield* new RequestError({ message: `Refusing to call outside ${provider.baseUrl}` });
    const client = yield* HttpClient.HttpClient;
    let outgoing = HttpClientRequest.make(request.method)(target).pipe(
      HttpClientRequest.setHeaders(provider.headers(auth)),
    );
    if (request.body !== undefined)
      outgoing = yield* HttpClientRequest.bodyJson(outgoing, request.body).pipe(
        Effect.mapError(() => new RequestError({ message: "Could not encode the request body" })),
      );
    const response = yield* client
      .execute(outgoing)
      .pipe(
        Effect.mapError(
          () => new RequestError({ message: `${provider.displayName} request failed` }),
        ),
      );
    const tooLarge = new RequestError({
      message: `${provider.displayName} response exceeds 1 MiB`,
    });
    if (Number(response.headers["content-length"] ?? 0) > maxResponseBytes) return yield* tooLarge;
    const text = yield* response.text.pipe(
      Effect.mapError(
        () => new RequestError({ message: `Could not read the ${provider.displayName} response` }),
      ),
    );
    if (new TextEncoder().encode(text).byteLength > maxResponseBytes) return yield* tooLarge;
    let body: Schema.Json = text;
    if (text.length === 0) body = null;
    else
      try {
        body = JSON.parse(text) as Schema.Json;
      } catch {}
    return { status: response.status, body } satisfies Response;
  }).pipe(
    Effect.scoped,
    Effect.updateService(Headers.CurrentRedactedNames, (names) => [...names, "authorization"]),
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual", credentials: "omit" }),
    Effect.timeoutOrElse({
      duration: "30 seconds",
      orElse: () => new RequestError({ message: `${provider.displayName} request timed out` }),
    }),
  );
