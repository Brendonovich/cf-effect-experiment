import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect } from "effect";

import {
  ClientConnected,
  ClientDisconnected,
  ClientId,
  MessageReceived,
  ServerId,
  WebSocketServer,
} from "../src/Definition.ts";
import WebSocketServerPlugin from "../src/Plugin.ts";

describe("WebSocket server plugin", () => {
  it.effect("registers resource-filtered events and typed send actions", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(WebSocketServerPlugin.effect);
      assert.deepStrictEqual(
        schemas.map(({ id, type }) => ({ id, type })),
        [
          { id: "SendToClient", type: "exec" },
          { id: "Broadcast", type: "exec" },
          { id: "ClientConnected", type: "event" },
          { id: "ClientDisconnected", type: "event" },
          { id: "MessageReceived", type: "event" },
        ],
      );
      for (const schema of schemas) {
        assert.deepStrictEqual(
          schema.properties.map((property) => ({
            id: property.id,
            resource: "resource" in property ? property.resource : undefined,
          })),
          [{ id: "server", resource: WebSocketServer.key }],
        );
      }

      const serverId = ServerId.make("server");
      const otherServerId = ServerId.make("other");
      const clientId = ClientId.make("client");
      assert.isTrue(
        yield* schemas[2]!.matches(new ClientConnected({ serverId, clientId }), {
          server: serverId,
        }),
      );
      assert.isFalse(
        yield* schemas[2]!.matches(new ClientConnected({ serverId: otherServerId, clientId }), {
          server: serverId,
        }),
      );
      assert.isTrue(
        yield* schemas[4]!.matches(new MessageReceived({ serverId, clientId, message: "hello" }), {
          server: serverId,
        }),
      );

      const disconnected = schemas[3]!;
      const outputs: Array<unknown> = [];
      yield* disconnected.run({
        input: () => undefined,
        output: (_ref, value) => outputs.push(value),
        properties: { server: serverId },
        event: new ClientDisconnected({
          serverId,
          clientId,
          cause: "error",
          reason: "Peer failed",
        }),
        engine: {},
        execution: {
          projectId: "project",
          graphId: "graph",
          eventNodeId: "event",
          traceId: "trace",
        },
        node: {
          nodeId: "node",
          kind: "event",
          executionPath: "event:node",
          traceId: "trace",
          withSpan: <A, E, R>(_name: string, effect: Effect.Effect<A, E, R>) => effect,
        },
      });
      assert.deepStrictEqual(outputs, [clientId, "error", "Peer failed"]);
    }),
  );
});
