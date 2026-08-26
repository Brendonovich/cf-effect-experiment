import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect } from "effect";

import {
  ConnectionId,
  MessageReceived,
  WebSocketConnection,
} from "../src/Definition.ts";
import WebSocketClientPlugin from "../src/Plugin.ts";

describe("WebSocket client plugin", () => {
  it.effect(
    "registers a resource-backed send action and filtered receive event",
    () =>
      Effect.gen(function* () {
        const schemas = yield* Registration.collect(
          WebSocketClientPlugin.effect,
        );
        assert.deepStrictEqual(
          schemas.map(({ id, type }) => ({ id, type })),
          [
            { id: "SendMessage", type: "exec" },
            { id: "MessageReceived", type: "event" },
          ],
        );
        for (const schema of schemas) {
          assert.deepStrictEqual(
            schema.properties.map((property) => ({
              id: property.id,
              resource: "resource" in property ? property.resource : undefined,
            })),
            [{ id: "connection", resource: WebSocketConnection.key }],
          );
        }

        const id = ConnectionId.make("primary");
        const other = ConnectionId.make("other");
        const eventSchema = schemas[1]!;
        assert.isTrue(
          yield* eventSchema.matches(
            new MessageReceived({ connectionId: id, data: "hello" }),
            {
              connection: id,
            },
          ),
        );
        assert.isFalse(
          yield* eventSchema.matches(
            new MessageReceived({ connectionId: other, data: "hello" }),
            {
              connection: id,
            },
          ),
        );

        const outputs: Array<unknown> = [];
        const execution = {
          projectId: "project",
          graphId: "graph",
          eventNodeId: "event",
          traceId: "trace",
        };
        const node = {
          nodeId: "node",
          kind: "exec" as const,
          executionPath: "node",
          traceId: "trace",
          withSpan: <A, E, R>(_name: string, effect: Effect.Effect<A, E, R>) =>
            effect,
        };
        yield* eventSchema.run({
          input: () => undefined,
          output: (_ref, value) => outputs.push(value),
          properties: { connection: id },
          event: new MessageReceived({ connectionId: id, data: "hello" }),
          engine: {},
          execution,
          node,
        });
        assert.deepStrictEqual(outputs, ["hello"]);

        const sent: Array<unknown> = [];
        yield* schemas[0]!.run({
          input: () => "outbound",
          output: () => undefined,
          properties: { connection: id },
          event: undefined,
          engine: {
            WebSocketSendMessage: (payload: unknown) =>
              Effect.sync(() => {
                sent.push(payload);
              }),
          },
          execution,
          node,
        });
        assert.deepStrictEqual(sent, [{ connectionId: id, data: "outbound" }]);
      }),
  );
});
