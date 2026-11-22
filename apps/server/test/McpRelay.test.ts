import { assert, describe, it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { FetchHttpClient } from "effect/http";
import { once } from "node:events";
import { createServer, type IncomingHttpHeaders } from "node:http";

import { McpRelay } from "../src/McpRelay.ts";
import { ServiceClient } from "../src/ServiceClient.ts";

interface Received {
  readonly url: string | undefined;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

/** A stand-in for the service's `/api/mcp`, recording what the relay sends. */
const fakeService = Effect.acquireRelease(
  Effect.promise(async () => {
    const received: Array<Received> = [];
    const server = createServer((request, response) => {
      let text = "";
      request.on("data", (chunk: Buffer) => (text += chunk.toString()));
      request.on("end", () => {
        const body: unknown = JSON.parse(text);
        received.push({ url: request.url, headers: request.headers, body });
        if (request.headers.authorization !== "Bearer local-token") {
          response.writeHead(401).end();
          return;
        }
        const message = body as { id?: number; method: string };
        if (message.id === undefined) {
          response.writeHead(202).end();
          return;
        }
        response.writeHead(200, {
          "content-type": "application/json",
          ...(message.method === "initialize" ? { "mcp-session-id": "session-1" } : {}),
        });
        // Pretty-printed, so the relay must put it back on one line.
        response.end(
          JSON.stringify(
            {
              jsonrpc: "2.0",
              id: message.id,
              result:
                message.method === "initialize"
                  ? { ok: message.method, instructions: "Server instructions." }
                  : { ok: message.method },
            },
            null,
            2,
          ),
        );
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No address");
    return { server, received, url: `http://127.0.0.1:${address.port}/base` };
  }),
  ({ server }) =>
    Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
);

const relay = (lines: ReadonlyArray<string>, endpoint: ServiceClient.Endpoint) =>
  Effect.gen(function* () {
    const output: Array<string> = [];
    yield* McpRelay.run({
      input: Stream.fromIterable(lines),
      write: (line) => Effect.sync(() => void output.push(line)),
      connect: Effect.succeed(endpoint),
      retryFor: "200 millis",
      instructions: "Bridge instructions.",
    });
    return output;
  }).pipe(Effect.provide(FetchHttpClient.layer));

describe("MCP stdio relay", () => {
  it.live("posts each message, carries the session and keeps notifications silent", () =>
    Effect.gen(function* () {
      const service = yield* fakeService;
      const output = yield* relay(
        [
          JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
          JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
          "",
          JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
          "not json",
        ],
        { url: service.url, token: "local-token" },
      );

      const responses = output.map((line) => JSON.parse(line));
      assert.strictEqual(responses[0].result.ok, "initialize");
      assert.strictEqual(
        responses[0].result.instructions,
        "Server instructions.\n\nBridge instructions.",
      );
      assert.deepStrictEqual(responses.slice(1), [
        { jsonrpc: "2.0", id: 2, result: { ok: "tools/list" } },
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
      ]);
      assert.isTrue(output.every((line) => !line.includes("\n")));
      assert.deepStrictEqual(
        service.received.map(({ url, headers }) => [
          url,
          headers.authorization,
          headers["mcp-session-id"],
        ]),
        [
          ["/base/api/mcp", "Bearer local-token", undefined],
          ["/base/api/mcp", "Bearer local-token", "session-1"],
          ["/base/api/mcp", "Bearer local-token", "session-1"],
        ],
      );
    }).pipe(Effect.scoped),
  );

  it.live("answers requests with JSON-RPC errors when the service refuses them", () =>
    Effect.gen(function* () {
      const service = yield* fakeService;
      const output = yield* relay(
        [
          JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list" }),
          JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        ],
        { url: service.url, token: "wrong" },
      );
      assert.strictEqual(output.length, 1);
      const response = JSON.parse(output[0]!);
      assert.strictEqual(response.id, 7);
      assert.strictEqual(response.error.code, -32603);
      assert.include(response.error.message, "401");
    }).pipe(Effect.scoped),
  );

  it.live("fails before reading input when it cannot reach the service", () =>
    Effect.gen(function* () {
      const error = yield* McpRelay.run({
        input: Stream.fromIterable(["{}"]),
        write: () => Effect.die("Nothing should be written"),
        connect: Effect.fail(new ServiceClient.ServiceError({ message: "no service" })),
      }).pipe(Effect.provide(FetchHttpClient.layer), Effect.flip);
      assert.strictEqual(error.message, "no service");
    }),
  );

  it.live("waits for a restarting service and follows it to its new URL", () =>
    Effect.gen(function* () {
      const service = yield* fakeService;
      const restarting = yield* Effect.acquireRelease(
        Effect.promise(async () => {
          const server = createServer((_, response) => response.writeHead(502).end());
          server.listen(0, "127.0.0.1");
          await once(server, "listening");
          const address = server.address();
          if (address === null || typeof address === "string") throw new Error("No address");
          return { server, url: `http://127.0.0.1:${address.port}` };
        }),
        ({ server }) =>
          Effect.promise(() => new Promise<void>((resolve) => server.close(() => resolve()))),
      );
      let connections = 0;
      const output: Array<string> = [];
      yield* McpRelay.run({
        input: Stream.fromIterable([
          JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        ]),
        write: (line) => Effect.sync(() => void output.push(line)),
        // The first lookup finds the old instance; later ones find its replacement.
        connect: Effect.sync(() =>
          connections++ < 2
            ? { url: restarting.url, token: "local-token" }
            : { url: service.url, token: "local-token" },
        ),
      }).pipe(Effect.provide(FetchHttpClient.layer));
      assert.deepStrictEqual(
        output.map((line) => JSON.parse(line)),
        [{ jsonrpc: "2.0", id: 1, result: { ok: "tools/list" } }],
      );
      assert.isAtLeast(connections, 3);
    }).pipe(Effect.scoped),
  );
});
