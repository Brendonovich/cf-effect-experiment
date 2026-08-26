import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { RpcTest } from "effect/unstable/rpc";

import {
  ClientRpcs,
  HttpClientEngine,
  type RequestMethod,
  RequestFailure,
  RuntimeRpcs,
} from "./Definition.ts";
import { Service as UrlPolicy, localLayer as localPolicyLayer, secureLayer } from "./UrlPolicy.ts";

const maxRedirects = 5;
const requestTimeout = "30 seconds";
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

const failure = (method: RequestMethod, url: string, reason: string) =>
  new RequestFailure({ method, url, reason });

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const redactInput = (input: string) =>
  input.replace(/^([a-z][a-z\d+.-]*:\/\/)[^/?#]*@/i, "$1[redacted]@");

const displayUrl = (url: URL) => {
  const safe = new URL(url);
  safe.username = "";
  safe.password = "";
  return safe.href;
};

export const make = Effect.fnUntraced(function* () {
  const client = yield* HttpClient.HttpClient;
  const scopedClient = HttpClient.withScope(client);
  const policy = yield* UrlPolicy;

  const parseUrl = (method: RequestMethod, input: string, base?: URL) =>
    Effect.try({
      try: () => {
        const url = base === undefined ? new URL(input) : new URL(input, base);
        url.hash = "";
        return url;
      },
      catch: () => failure(method, redactInput(input), "Invalid URL"),
    });

  const request = Effect.fnUntraced(function* (method: RequestMethod, input: string) {
    const initial = yield* parseUrl(method, input);

    const loop = Effect.fnUntraced(function* (
      currentMethod: RequestMethod,
      url: URL,
      redirects: number,
      visited: ReadonlySet<string>,
    ): Effect.fn.Return<number, RequestFailure> {
      yield* policy
        .check(url)
        .pipe(Effect.mapError((error) => failure(currentMethod, displayUrl(url), error.reason)));
      const response = yield* scopedClient.execute(HttpClientRequest.make(currentMethod)(url)).pipe(
        Effect.map((response) => ({
          status: response.status,
          location: response.headers.location,
        })),
        Effect.scoped,
        Effect.provideService(FetchHttpClient.RequestInit, {
          redirect: "manual",
          credentials: "omit",
        }),
        Effect.mapError((error) =>
          failure(currentMethod, displayUrl(url), `Request failed: ${message(error)}`),
        ),
      );
      if (!redirectStatuses.has(response.status) || response.location === undefined)
        return response.status;
      if (redirects >= maxRedirects)
        return yield* failure(
          currentMethod,
          displayUrl(url),
          `Redirect limit of ${maxRedirects} exceeded`,
        );
      const next = yield* parseUrl(currentMethod, response.location, url);
      const nextMethod: RequestMethod =
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && currentMethod === "POST")
          ? "GET"
          : currentMethod;
      const key = `${nextMethod} ${next.href}`;
      if (visited.has(key))
        return yield* failure(nextMethod, displayUrl(next), "Redirect loop detected");
      return yield* loop(nextMethod, next, redirects + 1, new Set([...visited, key]));
    });

    return yield* loop(method, initial, 0, new Set([`${method} ${initial.href}`])).pipe(
      Effect.timeoutOrElse({
        duration: requestTimeout,
        orElse: () =>
          failure(method, displayUrl(initial), `Request timed out after ${requestTimeout}`),
      }),
    );
  });

  return HttpClientEngine.of({
    resources: Layer.empty,
    rpcs: RuntimeRpcs.toLayer({
      HttpClientRequest: ({ method, url }) => request(method, url),
    }),
    client: {
      state: Effect.succeed({}),
      rpcs: ClientRpcs.toLayer({}),
    },
  });
});

export const layer = Layer.effect(HttpClientEngine)(make());
export const productionLayer = layer.pipe(Layer.provide(secureLayer));
export const localLayer = layer.pipe(Layer.provide(localPolicyLayer));

export const makeRuntimeClient = Effect.fnUntraced(function* () {
  const engine = yield* make();
  return yield* RpcTest.makeClient(RuntimeRpcs).pipe(Effect.provide(engine.rpcs));
});

export default productionLayer;
