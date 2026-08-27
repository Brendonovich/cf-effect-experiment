import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import {
  ClientConnected,
  ClientDisconnected,
  MessageReceived,
  WebSocketServerEngine,
  ClientRpcs as BaseClientRpcs,
} from "@macrograph/plugin-websocket-server/Definition";
import { Effect } from "effect";

import {
  ClientId,
  ClientRpcs,
  DEFAULT_PORT,
  type KeyEvent,
  ServerId,
  StreamDeckEngine,
  StreamDeckServer,
} from "../src/Definition.ts";
import plugin from "../src/Plugin.ts";
import { makeReceiver } from "../src/Protocol.ts";

const payload = {
  coordinates: { column: 1, row: 2 },
  isInMultiAction: false,
  settings: { id: "my-key", remoteServer: "ws://localhost:1880" },
};

describe("Stream Deck", () => {
  it.effect("accepts valid key events only from each server's first connected client", () =>
    Effect.gen(function* () {
      const events: KeyEvent[] = [];
      const receive = makeReceiver((event) =>
        Effect.sync(() => {
          events.push(event);
        }),
      );
      const serverId = ServerId.make("deck");
      const otherServer = ServerId.make("other-server");
      const first = ClientId.make("first");
      const other = ClientId.make("other");
      const message = (clientId: ClientId, event: string, server = serverId) =>
        new MessageReceived({
          serverId: server,
          clientId,
          message: JSON.stringify({ event, payload }),
        });
      yield* receive(message(first, "keyDown"));
      yield* receive(new ClientConnected({ serverId, clientId: first }));
      yield* receive(new ClientConnected({ serverId, clientId: other }));
      yield* receive(message(other, "keyDown"));
      yield* receive(message(first, "keyDown"));
      yield* receive(message(first, "keyUp"));
      yield* receive(new ClientConnected({ serverId: otherServer, clientId: other }));
      yield* receive(message(other, "keyDown", otherServer));
      assert.deepStrictEqual(
        events.map((event) => [event.serverId, event.event, event.payload.settings.id]),
        [
          [serverId, "keyDown", "my-key"],
          [serverId, "keyUp", "my-key"],
          [otherServer, "keyDown", "my-key"],
        ],
      );
      yield* receive(
        new ClientDisconnected({ serverId, clientId: other, cause: "peer", reason: "closed" }),
      );
      yield* receive(message(first, "keyDown"));
      assert.strictEqual(events.length, 4);
      yield* receive(
        new ClientDisconnected({ serverId, clientId: first, cause: "server", reason: "stopped" }),
      );
      yield* receive(message(first, "keyDown"));
      yield* receive(message(other, "keyDown"));
      assert.strictEqual(events.length, 4);
      yield* receive(new ClientConnected({ serverId, clientId: other }));
      yield* receive(message(other, "keyUp"));
      assert.strictEqual(events.length, 5);
    }),
  );
  it.effect("drops malformed/unknown messages without breaking subsequent events", () =>
    Effect.gen(function* () {
      const events: KeyEvent[] = [];
      const receive = makeReceiver((event) =>
        Effect.sync(() => {
          events.push(event);
        }),
      );
      const serverId = ServerId.make("deck");
      const clientId = ClientId.make("client");
      yield* receive(new ClientConnected({ serverId, clientId }));
      for (const message of [
        "not-json",
        "null",
        "{}",
        JSON.stringify({ event: "dialRotate", payload }),
        JSON.stringify({
          event: "keyDown",
          payload: { ...payload, settings: { id: 123, remoteServer: "" } },
        }),
        JSON.stringify({ event: "keyDown", payload: { settings: payload.settings } }),
      ]) {
        yield* receive(new MessageReceived({ serverId, clientId, message }));
      }
      assert.strictEqual(events.length, 0);
      yield* receive(
        new MessageReceived({
          serverId,
          clientId,
          message: JSON.stringify({ event: "keyDown", payload }),
        }),
      );
      assert.strictEqual(events.length, 1);
      const schemas = yield* Registration.collect(plugin.effect);
      assert.deepStrictEqual(
        schemas.map((schema) => schema.id),
        ["KeyDown", "KeyUp"],
      );
      assert.isTrue(yield* schemas[0]!.matches(events[0]!, { server: serverId }));
      assert.isFalse(yield* schemas[1]!.matches(events[0]!, { server: serverId }));
      assert.isFalse(yield* schemas[0]!.matches(events[0]!, { server: ServerId.make("other") }));
      const outputs: unknown[] = [];
      yield* schemas[0]!.run({
        input: () => undefined,
        output: (_ref, value) => outputs.push(value),
        properties: { server: serverId },
        event: events[0],
        engine: {},
        execution: {
          projectId: "project",
          graphId: "graph",
          eventNodeId: "event",
          traceId: "trace",
        },
        node: {
          nodeId: "node",
          kind: "exec",
          executionPath: "node",
          traceId: "trace",
          withSpan: <A, E, R>(_name: string, effect: Effect.Effect<A, E, R>) => effect,
        },
      });
      assert.deepStrictEqual(outputs, ["my-key"]);
      assert.deepStrictEqual(
        schemas[0]!.properties.map((property) =>
          "resource" in property ? property.resource : undefined,
        ),
        [StreamDeckServer.key],
      );
      assert.strictEqual(DEFAULT_PORT, 1880);
      assert.notStrictEqual(StreamDeckEngine.key, WebSocketServerEngine.key);
      for (const tag of ClientRpcs.requests.keys())
        assert.isFalse(BaseClientRpcs.requests.has(tag));
    }),
  );
});
