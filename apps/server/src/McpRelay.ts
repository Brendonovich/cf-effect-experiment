import { Duration, Effect, Option, Result, Stream } from "effect";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";

import type { ServiceClient } from "./ServiceClient.ts";

type JsonRpcId = string | number | null;

/** Statuses a restarting service answers with: a rotated token, or a proxy without a backend. */
const unavailable = new Set([401, 502, 503, 504]);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const rpcError = (id: JsonRpcId, code: number, message: string) =>
  JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });

/** The IDs of the requests in a message or batch; notifications and responses have none. */
const requestIds = (message: unknown): ReadonlyArray<JsonRpcId> =>
  (Array.isArray(message) ? message : [message]).flatMap((entry) =>
    isRecord(entry) &&
    typeof entry.method === "string" &&
    (typeof entry.id === "string" || typeof entry.id === "number" || entry.id === null)
      ? [entry.id]
      : [],
  );

/** The methods of the requests in a message or batch. */
const requestMethods = (message: unknown): ReadonlyArray<string> =>
  (Array.isArray(message) ? message : [message]).flatMap((entry) =>
    isRecord(entry) && typeof entry.method === "string" ? [entry.method] : [],
  );

/**
 * Appends this transport's instructions to an `initialize` result, leaving errors and other
 * methods alone. The server's instructions describe the product; a bridge can add what only it
 * knows, such as how to check the local connection.
 */
const withInstructions = (value: unknown, instructions: string | undefined) => {
  if (instructions === undefined || !isRecord(value) || !isRecord(value.result)) return value;
  const existing = typeof value.result.instructions === "string" ? value.result.instructions : "";
  return {
    ...value,
    result: {
      ...value.result,
      instructions: existing === "" ? instructions : `${existing}\n\n${instructions}`,
    },
  };
};

const parse = (
  text: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } => {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
};

export interface Options<E, R> {
  /** Newline-delimited JSON-RPC messages from the MCP client. */
  readonly input: Stream.Stream<string, E, R>;
  /** Writes one line of output for the MCP client. */
  readonly write: (line: string) => Effect.Effect<void>;
  /** How long a message waits for an unavailable service. Defaults to 15 seconds. */
  readonly retryFor?: Duration.Input;
  /** Added to the server's `initialize` instructions, when this transport has something to say. */
  readonly instructions?: string;
  /** Finds or starts the service; called up front and again if it stops answering. */
  readonly connect: Effect.Effect<ServiceClient.Endpoint, ServiceClient.ServiceError, R>;
}

/**
 * Relays MCP's stdio transport to the service's streamable HTTP endpoint. Each message is posted
 * to `<url>/api/mcp` with the local token, carrying the session ID the service assigned, and each
 * response is written as one line. Notifications produce no output. If the service cannot answer
 * a request, the client gets a JSON-RPC error for it so it never waits forever.
 */
export const run = <E, R>(options: Options<E, R>) =>
  Effect.gen(function* () {
    let endpoint = yield* options.connect;
    let sessionId: string | undefined;

    const post = (body: string) =>
      HttpClient.execute(
        HttpClientRequest.post(`${endpoint.url}/api/mcp`).pipe(
          HttpClientRequest.bearerToken(endpoint.token),
          HttpClientRequest.setHeaders({
            accept: "application/json, text/event-stream",
            ...(sessionId === undefined ? {} : { "mcp-session-id": sessionId }),
          }),
          HttpClientRequest.bodyText(body, "application/json"),
        ),
      ).pipe(
        Effect.flatMap((response) =>
          response.text.pipe(Effect.map((text) => ({ response, text }))),
        ),
      );

    // While a service restarts (a source change in `pnpm dev`, a hot reload in `dev:inline`, or
    // `service restart`) it refuses connections, answers 502-504 through a proxy, or comes back
    // with a new URL or token. Messages wait for it, reconnecting, rather than failing.
    const send = (body: string) =>
      Effect.gen(function* () {
        const deadline =
          Date.now() +
          Duration.toMillis(Duration.fromInputUnsafe(options.retryFor ?? "15 seconds"));
        while (true) {
          const result = yield* Effect.result(post(body));
          const retry = Result.isFailure(result) || unavailable.has(result.success.response.status);
          if (!retry || Date.now() >= deadline) return yield* Effect.fromResult(result);
          yield* Effect.sleep(Duration.millis(250));
          const next = yield* Effect.option(options.connect);
          if (Option.isSome(next)) endpoint = next.value;
        }
      });

    const fail = (ids: ReadonlyArray<JsonRpcId>, message: string) =>
      Effect.logError(message).pipe(
        Effect.andThen(Effect.forEach(ids, (id) => options.write(rpcError(id, -32603, message)))),
      );

    const relay = (
      response: HttpClientResponse.HttpClientResponse,
      text: string,
      ids: ReadonlyArray<JsonRpcId>,
      methods: ReadonlyArray<string>,
    ) =>
      Effect.gen(function* () {
        const session = response.headers["mcp-session-id"];
        if (session !== undefined) sessionId = session;
        if (response.status === 202 || text.trim() === "") {
          if (response.status >= 400)
            yield* fail(ids, `The MacroGraph service answered HTTP ${response.status}`);
          return;
        }
        const parsed = parse(text);
        if (!parsed.ok)
          return yield* fail(
            ids,
            `The MacroGraph service answered HTTP ${response.status} without JSON`,
          );
        yield* options.write(
          JSON.stringify(
            methods.includes("initialize")
              ? withInstructions(parsed.value, options.instructions)
              : parsed.value,
          ),
        );
      });

    yield* Stream.runForEach(options.input, (line) =>
      Effect.gen(function* () {
        const text = line.trim();
        if (text === "") return;
        const message = parse(text);
        if (!message.ok) return yield* options.write(rpcError(null, -32700, "Parse error"));
        const ids = requestIds(message.value);
        const methods = requestMethods(message.value);
        yield* send(text).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              fail(
                ids,
                `Could not reach the MacroGraph service: ${error instanceof Error ? error.message : String(error)}`,
              ),
            onSuccess: ({ response, text }) => relay(response, text, ids, methods),
          }),
        );
      }),
    );
  });

export * as McpRelay from "./McpRelay.ts";
