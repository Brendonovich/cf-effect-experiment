import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { ClientRpcs as BaseClientRpcs } from "@macrograph/plugin-websocket-server/Definition";
import * as Protocol from "@macrograph/streamdeck-protocol";
import * as Wire from "@macrograph/streamdeck-protocol/schema";
import { Effect, Schema } from "effect";

import {
  ButtonId,
  ClientRpcs,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DeviceId,
  StreamDeckButton,
  StreamDeckEngine,
  StreamDeckKeyDown,
  StreamDeckServer,
} from "../src/Definition.ts";
import plugin from "../src/Plugin.ts";

describe("Stream Deck protocol + schemas", () => {
  it.effect("decodes and encodes the wire protocol", () =>
    Effect.gen(function* () {
      const hello = yield* Schema.decodeUnknownEffect(Wire.Hello)(
        Protocol.hello("com.macrograph.streamdeck"),
      );
      assert.strictEqual(hello.type, "hello");
      assert.strictEqual(hello.version, Protocol.PROTOCOL_VERSION);
      assert.strictEqual(Protocol.CLIENT_ID, "macrograph-streamdeck");
      assert.strictEqual(Protocol.BUTTON_SETTING_KEY, "mgButtonId");

      const keyDown = yield* Schema.decodeUnknownEffect(Wire.PluginMessage)(
        Protocol.keyDown({
          deviceId: "d1",
          action: "com.macrograph.streamdeck.button",
          context: "c1",
          coordinates: { column: 0, row: 1 },
          settings: { [Protocol.BUTTON_SETTING_KEY]: "btn" },
          payload: { n: 1 },
        }),
      );
      assert.strictEqual(keyDown.type, "keyDown");

      const encoded = yield* Schema.encodeUnknownEffect(Wire.MasterMessage)(
        Protocol.setTitle("c1", "Hello", 1),
      );
      assert.deepStrictEqual(encoded, {
        type: "setTitle",
        context: "c1",
        title: "Hello",
        state: 1,
      });

      const bad = yield* Schema.decodeUnknownEffect(Wire.PluginMessage)({
        type: "keyDown",
      }).pipe(Effect.result);
      assert.isTrue(bad._tag === "Failure");
    }),
  );

  it.effect("registers event and action schemas filtered by button", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      const ids = schemas.map((schema) => schema.id);
      for (const id of ["KeyDown", "KeyUp", "SetButtonState", "SetButtonTitle"] as const)
        assert.isTrue(ids.includes(id), `missing schema ${id}`);
      assert.strictEqual(ids.length, 4);

      const event = new StreamDeckKeyDown({
        deviceId: DeviceId.make("device"),
        buttonId: ButtonId.make("btn-1"),
        buttonName: "Mute",
        context: "ctx",
        column: 0,
        row: 0,
        state: 1,
        settings: { [Protocol.BUTTON_SETTING_KEY]: "btn-1" },
        payload: { ok: true, state: 1 },
      });
      assert.isTrue(yield* schemas[0]!.matches(event, {}));
      assert.isTrue(yield* schemas[0]!.matches(event, { button: ButtonId.make("btn-1") }));
      assert.isFalse(yield* schemas[0]!.matches(event, { button: ButtonId.make("other") }));
      assert.isFalse(yield* schemas[1]!.matches(event, { button: ButtonId.make("btn-1") }));

      const allOutputs: unknown[] = [];
      yield* schemas[0]!.run({
        input: () => undefined,
        output: (_ref, value) => allOutputs.push(value),
        properties: {},
        event,
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
      assert.deepStrictEqual(allOutputs, [
        "Mute",
        true,
        "device",
        JSON.stringify({ ok: true, state: 1 }),
        JSON.stringify({ [Protocol.BUTTON_SETTING_KEY]: "btn-1" }),
      ]);

      const filteredOutputs: unknown[] = [];
      yield* schemas[0]!.run({
        input: () => undefined,
        output: (_ref, value) => filteredOutputs.push(value),
        properties: { button: ButtonId.make("btn-1") },
        event,
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
      assert.deepStrictEqual(filteredOutputs, [
        "Mute",
        true,
        "device",
        JSON.stringify({ ok: true, state: 1 }),
        JSON.stringify({ [Protocol.BUTTON_SETTING_KEY]: "btn-1" }),
      ]);

      assert.deepStrictEqual(
        schemas[0]!.properties.map((property) =>
          "resource" in property
            ? { resource: property.resource, optional: property.optional }
            : undefined,
        ),
        [{ resource: StreamDeckButton.key, optional: true }],
      );
      assert.strictEqual(DEFAULT_PORT, 1880);
      assert.strictEqual(DEFAULT_HOST, "0.0.0.0");
      assert.notStrictEqual(StreamDeckServer.key, StreamDeckButton.key);
      assert.notStrictEqual(StreamDeckEngine.key, "WebSocketServer");
      for (const tag of ClientRpcs.requests.keys())
        assert.isFalse(BaseClientRpcs.requests.has(tag));
    }),
  );
});
