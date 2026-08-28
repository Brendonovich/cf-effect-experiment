import { Effect, Layer, Stream } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { RpcTest } from "effect/unstable/rpc";

import {
  ClientRpcs,
  HttpClientEngine,
  type RequestMethod,
  RequestFailure,
  RuntimeRpcs,
  type TextResponse,
} from "./Definition.ts";
import { Service as UrlPolicy, localLayer as localPolicyLayer, secureLayer } from "./UrlPolicy.ts";

const maxRedirects = 5;
const requestTimeout = "30 seconds";
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
export const maxBodyBytes = 1024 * 1024;
export const maxHeaderBytes = 64 * 1024;
const forbiddenHeaders = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "upgrade",
  "expect",
  "trailer",
  "te",
  "keep-alive",
]);

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

  const request = Effect.fnUntraced(function* (
    method: RequestMethod,
    input: string,
    readBody = false,
    body = "",
    headerJson = "{}",
  ) {
    const initial = yield* parseUrl(method, input);
    const encoder = new TextEncoder();
    if (encoder.encode(body).byteLength > maxBodyBytes)
      return yield* failure(
        method,
        displayUrl(initial),
        `Request body exceeds ${maxBodyBytes} bytes`,
      );
    if (method === "GET" && body !== "")
      return yield* failure(method, displayUrl(initial), "GET requests cannot have a body");
    if (encoder.encode(headerJson).byteLength > maxHeaderBytes)
      return yield* failure(
        method,
        displayUrl(initial),
        `Request headers exceed ${maxHeaderBytes} bytes`,
      );
    const parsed: unknown = yield* Effect.try({
      try: () => JSON.parse(headerJson),
      catch: () => failure(method, displayUrl(initial), "Headers must be valid JSON"),
    });
    const invalidRequest = (reason: string) =>
      failure(method, displayUrl(initial), `Invalid request: ${reason}`);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return yield* invalidRequest("Headers must be a JSON object with string values");
    const normalized = new Headers();
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string")
        return yield* invalidRequest("Headers must be a JSON object with string values");
      if (!/^[!#$%&'*+.^_`|~\da-z-]+$/i.test(key) || /[^\t\x20-\x7e\x80-\xff]/.test(value))
        return yield* invalidRequest("Invalid HTTP header name or value");
      const name = key.toLowerCase();
      if (forbiddenHeaders.has(name) || name.startsWith("proxy-") || name.startsWith("sec-"))
        return yield* invalidRequest("Transport-controlled request header is not allowed");
      if (normalized.has(name))
        return yield* invalidRequest("Duplicate case-insensitive request header");
      yield* Effect.try({
        try: () => normalized.set(key, value),
        catch: (error) => invalidRequest(message(error)),
      });
    }
    const headers = Object.fromEntries(normalized.entries());

    const loop = Effect.fnUntraced(function* (
      currentMethod: RequestMethod,
      url: URL,
      redirects: number,
      visited: ReadonlySet<string>,
      currentBody: string,
      currentHeaders: Readonly<Record<string, string>>,
    ): Effect.fn.Return<typeof TextResponse.Type, RequestFailure> {
      yield* policy
        .check(url)
        .pipe(Effect.mapError((error) => failure(currentMethod, displayUrl(url), error.reason)));
      let outgoing = HttpClientRequest.make(currentMethod)(url);
      if (currentBody !== "")
        outgoing = HttpClientRequest.bodyText(
          outgoing,
          currentBody,
          currentHeaders["content-type"] ?? "text/plain; charset=utf-8",
        );
      outgoing = HttpClientRequest.setHeaders(outgoing, currentHeaders);
      const response = yield* scopedClient.execute(outgoing).pipe(
        Effect.flatMap(
          Effect.fnUntraced(function* (response) {
            const location = response.headers.location;
            let text = "";
            if (readBody && (!redirectStatuses.has(response.status) || location === undefined)) {
              if (
                new TextEncoder().encode(JSON.stringify(response.headers)).byteLength >
                maxHeaderBytes
              )
                return yield* failure(
                  currentMethod,
                  displayUrl(url),
                  `Response headers exceed ${maxHeaderBytes} bytes`,
                );
              const length = Number(response.headers["content-length"]);
              if (length > maxBodyBytes)
                return yield* failure(
                  currentMethod,
                  displayUrl(url),
                  `Response body exceeds ${maxBodyBytes} bytes`,
                );
              const decoder = new TextDecoder();
              let bytes = 0;
              yield* response.stream.pipe(
                Stream.runForEach((chunk) => {
                  bytes += chunk.byteLength;
                  if (bytes > maxBodyBytes)
                    return failure(
                      currentMethod,
                      displayUrl(url),
                      `Response body exceeds ${maxBodyBytes} bytes`,
                    );
                  text += decoder.decode(chunk, { stream: true });
                  return Effect.void;
                }),
                Effect.catchTag("HttpClientError", (error) =>
                  error.reason._tag === "EmptyBodyError" ? Effect.void : Effect.fail(error),
                ),
              );
              text += decoder.decode();
            }
            return {
              status: response.status,
              body: text,
              headers: response.headers,
              contentType: response.headers["content-type"] ?? "",
            };
          }),
        ),
        Effect.scoped,
        Effect.provideService(FetchHttpClient.RequestInit, {
          redirect: "manual",
          credentials: "omit",
        }),
        Effect.mapError((error) =>
          error instanceof RequestFailure
            ? error
            : failure(currentMethod, displayUrl(url), `Request failed: ${message(error)}`),
        ),
      );
      if (!redirectStatuses.has(response.status) || response.headers.location === undefined)
        return response;
      if (redirects >= maxRedirects)
        return yield* failure(
          currentMethod,
          displayUrl(url),
          `Redirect limit of ${maxRedirects} exceeded`,
        );
      const next = yield* parseUrl(currentMethod, response.headers.location, url);
      const nextMethod: RequestMethod =
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && currentMethod === "POST")
          ? "GET"
          : currentMethod;
      const key = `${nextMethod} ${next.href}`;
      if (visited.has(key))
        return yield* failure(nextMethod, displayUrl(next), "Redirect loop detected");
      // Never forward caller credentials or custom secret headers to another origin.
      const nextHeaders = next.origin === url.origin ? { ...currentHeaders } : {};
      if (
        nextMethod !== "GET" &&
        currentBody !== "" &&
        currentHeaders["content-type"] !== undefined
      )
        nextHeaders["content-type"] = currentHeaders["content-type"];
      if (nextMethod === "GET" && currentMethod !== "GET") {
        delete nextHeaders["content-type"];
        delete nextHeaders["content-encoding"];
        delete nextHeaders["content-language"];
        delete nextHeaders["content-location"];
      }
      return yield* loop(
        nextMethod,
        next,
        redirects + 1,
        new Set([...visited, key]),
        nextMethod === "GET" ? "" : currentBody,
        nextHeaders,
      );
    });

    return yield* loop(
      method,
      initial,
      0,
      new Set([`${method} ${initial.href}`]),
      body,
      headers,
    ).pipe(
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
      HttpClientRequest: ({ method, url }) =>
        request(method, url).pipe(Effect.map((response) => response.status)),
      HttpClientRequestText: ({ method, url, body, headers }) =>
        request(method, url, true, body, headers),
    }),
    client: {
      state: Effect.succeed({}),
      rpcs: ClientRpcs.toLayer({}),
    },
  });
});

export const layer = HttpClientEngine.toLayer(() => make());
export const productionLayer = layer.pipe(Layer.provide(secureLayer));
export const localLayer = layer.pipe(Layer.provide(localPolicyLayer));

export const makeRuntimeClient = Effect.fnUntraced(function* () {
  const engine = yield* make();
  return yield* RpcTest.makeClient(RuntimeRpcs).pipe(Effect.provide(engine.rpcs));
});

export default productionLayer;
