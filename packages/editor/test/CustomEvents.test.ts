import { expect, it } from "@effect/vitest";
import { CustomEvent, Project } from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { DataType } from "@macrograph/plugin/DataType";
import { Effect, Layer, PubSub, Schema } from "effect";

import { Editor, EditorEvents, Packages } from "../src/index.ts";

const seed = Layer.effectDiscard(
  Effect.flatMap(Persistence.Service, (db) => db.saveProject(Project.empty())),
);
const layer = Editor.defaultLayer.pipe(
  Layer.provide(seed),
  Layer.provideMerge(Packages.defaultLayer),
  Layer.provideMerge(Persistence.layerMemory),
  Layer.provide(Layer.succeed(Editor.CustomEventsEnabled, true)),
);
const event: CustomEvent.Model = {
  id: "greeting",
  name: "Greeting",
  fields: [{ id: "message", name: "Message", type: DataType.String }],
};

it.effect(
  "keeps event and port identity through renames, removes invalid defaults and wires, and blocks in-use deletion",
  () =>
    Effect.gen(function* () {
      const editor = yield* Editor.Service;
      const events = yield* EditorEvents.Service;
      const subscription = yield* events.subscribe;
      yield* editor.customEvent.put(event);
      expect((yield* PubSub.take(subscription))._tag).toBe("CustomEventsChanged");
      const { graph } = yield* editor.graph.create({});
      const emit = yield* editor.node.create({
        graphID: graph.id,
        node: {
          schema: {
            package: CustomEvent.packageId,
            schema: CustomEvent.schemaId(event.id, "emit"),
          },
          inputDefaults: { "field:message": "hello" },
        },
      });
      const on = yield* editor.node.create({
        graphID: graph.id,
        node: {
          schema: { package: CustomEvent.packageId, schema: CustomEvent.schemaId(event.id, "on") },
        },
      });
      yield* editor.connection.create({
        graphID: graph.id,
        connection: {
          outNodeId: on.node.id,
          outIoId: CustomEvent.fieldId("message"),
          inNodeId: emit.node.id,
          inIoId: CustomEvent.fieldId("message"),
        },
      });
      yield* editor.customEvent.put({
        ...event,
        name: "Renamed",
        fields: [{ ...event.fields[0]!, name: "Text" }],
      });
      const renamed = yield* editor.project.snapshot();
      expect(renamed.project.graphs[graph.id]!.nodes[emit.node.id]!.schema.schema).toBe(
        "emit:greeting",
      );
      expect(renamed.project.graphs[graph.id]!.connections).toHaveLength(1);
      expect(renamed.nodeIO[graph.id]![emit.node.id]!.dataInputs[0]).toMatchObject({
        id: "field:message",
        name: "Text",
      });
      expect((yield* Effect.flip(editor.customEvent.delete(event.id)))._tag).toBe(
        "CustomEventInUse",
      );
      const changed = yield* editor.customEvent.put({ ...event, fields: [] });
      expect(changed.graphs[graph.id]!.connections).toEqual([]);
      expect(changed.graphs[graph.id]!.nodes[emit.node.id]!.inputDefaults).toEqual({});
      yield* editor.node.delete({ graphID: graph.id, nodeID: emit.node.id });
      yield* editor.node.delete({ graphID: graph.id, nodeID: on.node.id });
      yield* editor.customEvent.delete(event.id);
      expect((yield* editor.project.get()).customEvents).toEqual({});
    }).pipe(Effect.scoped, Effect.provide(layer)),
);

it("validates imported registries and defaults old projects", () => {
  expect(Schema.decodeUnknownSync(Project.Model)({ name: "old", graphs: {} }).customEvents).toEqual(
    {},
  );
  for (const customEvents of [
    { wrong: event },
    { greeting: { ...event, fields: [event.fields[0], event.fields[0]] } },
    { greeting: event, other: { ...event, id: "other" } },
    { greeting: { ...event, fields: [{ id: "x", name: "x", type: { _tag: "Struct" } }] } },
  ])
    expect(() =>
      Schema.decodeUnknownSync(Project.Model)({ ...Project.empty(), customEvents }),
    ).toThrow();
});

it.effect("roundtrips edited nested event types into generated Emit and On IO", () =>
  Effect.gen(function* () {
    const editor = yield* Editor.Service;
    const type = DataType.List(DataType.Option(DataType.List(DataType.Int)));
    yield* editor.customEvent.put({ ...event, fields: [{ ...event.fields[0]!, type }] });
    const { graph } = yield* editor.graph.create({});
    const emit = yield* editor.node.create({
      graphID: graph.id,
      node: {
        schema: { package: CustomEvent.packageId, schema: CustomEvent.schemaId(event.id, "emit") },
      },
    });
    const on = yield* editor.node.create({
      graphID: graph.id,
      node: {
        schema: { package: CustomEvent.packageId, schema: CustomEvent.schemaId(event.id, "on") },
      },
    });
    const edited = DataType.List(DataType.List(DataType.List(DataType.Bool)));
    yield* editor.customEvent.put({ ...event, fields: [{ ...event.fields[0]!, type: edited }] });
    const snapshot = yield* editor.project.snapshot();
    expect(snapshot.nodeIO[graph.id]![emit.node.id]!.dataInputs[0]!.type).toEqual(edited);
    expect(snapshot.nodeIO[graph.id]![on.node.id]!.dataOutputs[0]!.type).toEqual(edited);
    const encoded = yield* Schema.encodeUnknownEffect(Project.Model)(snapshot.project);
    expect(
      (yield* Schema.decodeUnknownEffect(Project.Model)(encoded)).customEvents[event.id]!.fields[0]!
        .type,
    ).toEqual(edited);
  }).pipe(Effect.provide(layer)),
);
