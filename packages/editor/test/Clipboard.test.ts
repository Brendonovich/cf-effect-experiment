import { expect, it } from "@effect/vitest";
import {
  Clipboard,
  ConnectionId,
  Graph,
  IoId,
  Node,
  NodeId,
  Package,
  PackageId,
  Project,
  SchemaId,
} from "@macrograph/core";
import { Persistence, PersistenceError } from "@macrograph/persistence";
import { DataType } from "@macrograph/plugin";
import { Effect, Layer, PubSub, Result, Schema } from "effect";

import { Editor, EditorEvent, EditorEvents, EditorRpc, Packages } from "../src/index.ts";

const ref = { package: PackageId.make("clipboard"), schema: SchemaId.make("node") };
const pkg: Package.Model = {
  id: ref.package,
  name: "Clipboard",
  resources: [{ id: "account", name: "Account" }],
  schemas: [
    {
      id: ref.schema,
      name: "Node",
      type: "exec",
      properties: [
        {
          id: "label",
          name: "Label",
          type: DataType.String,
          optional: false,
          defaultValue: "default",
        },
        { id: "account", name: "Account", resource: "account", optional: false },
      ],
      dataInputs: [{ id: IoId.make("text"), type: DataType.String }],
      dataOutputs: [{ id: IoId.make("text"), type: DataType.String }],
      executionInputs: [{ id: IoId.make("exec") }],
      executionOutputs: [{ id: IoId.make("exec") }],
    },
  ],
};
const node = (id: string, x: number): Node.Model => ({
  id: NodeId.make(id),
  name: id,
  schema: ref,
  properties: { label: "kept" },
  inputDefaults: { text: "input" },
  foldPins: true,
  position: { x, y: 13 },
});
const fragment: Clipboard.Fragment = {
  format: "macrograph/nodes",
  version: 1,
  nodes: [node("a", 11), node("b", 94)],
  connections: [
    {
      id: ConnectionId.make("edge"),
      outNodeId: "a",
      outIoId: IoId.make("text"),
      inNodeId: "b",
      inIoId: IoId.make("text"),
    },
  ],
};
const text = JSON.stringify(fragment);
const TestLayer = Editor.defaultLayer.pipe(
  Layer.provideMerge(Packages.defaultLayer),
  Layer.provideMerge(Persistence.layerMemory),
);
const setup = Effect.gen(function* () {
  const persistence = yield* Persistence.Service;
  yield* persistence.saveProject({
    ...Project.empty(),
    graphs: { destination: Graph.empty("destination") },
  });
  const packages = yield* Packages.Service;
  yield* packages.loadPackage(pkg);
  return yield* Editor.Service;
});

it.layer(TestLayer)((it) => {
  it.effect(
    "reconnects external incoming links only in the original editor and graph, skipping missing and occupied endpoints",
    () =>
      Effect.gen(function* () {
        const editor = yield* setup;
        const persistence = yield* Persistence.Service;
        const existing = node("existing", 0);
        yield* persistence.saveGraph({ ...Graph.empty("destination"), nodes: { existing } });
        const session = yield* editor.fragment.identity();
        const incoming = {
          ...fragment.connections[0]!,
          id: ConnectionId.make("incoming"),
          outNodeId: "existing",
          inNodeId: "a",
        };
        const missing = {
          ...incoming,
          id: ConnectionId.make("missing"),
          outNodeId: "gone",
          inIoId: IoId.make("exec"),
        };
        const externalText = JSON.stringify({
          ...fragment,
          source: { session, graphId: "destination" },
          externalConnections: [incoming, missing],
        });
        const pasted = yield* editor.fragment.paste({
          graphID: "destination",
          text: externalText,
          position: { x: 0, y: 0 },
        });
        expect(pasted.connections).toHaveLength(2);
        expect(pasted.connections[1]).toMatchObject({
          outNodeId: "existing",
          inNodeId: pasted.nodes[0]!.id,
        });
        const unrelated = yield* editor.fragment.paste({
          graphID: "destination",
          text: externalText.replace(session, "unrelated-instance"),
          position: { x: 0, y: 0 },
        });
        expect(unrelated.connections).toHaveLength(1);
        yield* persistence.saveGraph({ ...Graph.empty("other"), nodes: { existing } });
        expect(
          (yield* editor.fragment.paste({
            graphID: "other",
            text: externalText,
            position: { x: 0, y: 0 },
          })).connections,
        ).toHaveLength(1);
        const outgoing = {
          ...incoming,
          id: ConnectionId.make("outgoing"),
          outNodeId: "a",
          inNodeId: "existing",
        };
        yield* persistence.saveGraph({
          ...Graph.empty("destination"),
          nodes: { existing },
          connections: [{ ...outgoing, outNodeId: "existing" }],
        });
        const occupied = yield* editor.fragment.paste({
          graphID: "destination",
          text: JSON.stringify({
            ...fragment,
            source: { session, graphId: "destination" },
            externalConnections: [outgoing],
          }),
          position: { x: 0, y: 0 },
        });
        expect(occupied.connections).toHaveLength(1);
      }),
  );

  it.effect(
    "prompts for compatible resource constants and validates confirmed mappings atomically",
    () =>
      Effect.gen(function* () {
        const editor = yield* setup;
        const constant = yield* editor.constant.create({
          package: ref.package,
          resource: "account",
        });
        const before = yield* editor.project.get();
        const resourceText = text.replace('"label":"kept"', '"account":"missing"');
        const result = yield* editor.fragment
          .paste({ graphID: "destination", text: resourceText, position: { x: 0, y: 0 } })
          .pipe(Effect.result);
        expect(
          Result.isFailure(result) &&
            result.failure._tag === "ClipboardRebindRequired" &&
            result.failure.requests[0]!.candidates,
        ).toEqual([{ id: constant.constant.id, name: constant.constant.name }]);
        expect(yield* editor.project.get()).toEqual(before);
        expect(
          Result.isFailure(
            yield* editor.fragment
              .paste({
                graphID: "destination",
                text: resourceText,
                position: { x: 0, y: 0 },
                bindings: [{ nodeId: "a", property: "account", target: "wrong" }],
              })
              .pipe(Effect.result),
          ),
        ).toBe(true);
        expect(yield* editor.project.get()).toEqual(before);
        const pasted = yield* editor.fragment.paste({
          graphID: "destination",
          text: resourceText,
          position: { x: 0, y: 0 },
          bindings: [{ nodeId: "a", property: "account", target: constant.constant.id }],
        });
        expect(pasted.nodes[0]!.properties.account).toBe(constant.constant.id);
      }),
  );

  it.effect(
    "rebinds project event schemas and remaps differing field IDs, defaults and wires",
    () =>
      Effect.gen(function* () {
        const editor = yield* setup;
        const packages = yield* Packages.Service;
        const eventPackage = PackageId.make("project-events");
        const sourceIO = {
          dataInputs: [{ id: IoId.make("field:old"), name: "Message", type: DataType.String }],
          dataOutputs: [],
          executionInputs: [{ id: IoId.make("exec") }],
          executionOutputs: [{ id: IoId.make("exec") }],
        };
        yield* packages.loadPackage({
          id: eventPackage,
          name: "Events",
          resources: [],
          schemas: [
            {
              ...sourceIO,
              id: SchemaId.make("emit:new"),
              name: "Emit New",
              type: "exec",
              properties: [],
              dataInputs: [{ id: IoId.make("field:new"), name: "Message", type: DataType.String }],
            },
          ],
        });
        const eventNode = {
          ...node("event", 200),
          schema: { package: eventPackage, schema: SchemaId.make("emit:old") },
          properties: {},
          inputDefaults: { "field:old": "preserved" },
        };
        const eventText = JSON.stringify({
          ...fragment,
          nodes: [node("a", 0), eventNode],
          nodeIO: { event: sourceIO },
          connections: [{ ...fragment.connections[0], inNodeId: "event", inIoId: "field:old" }],
        });
        const before = yield* editor.project.get();
        const result = yield* editor.fragment
          .paste({ graphID: "destination", text: eventText, position: { x: 0, y: 0 } })
          .pipe(Effect.result);
        expect(Result.isFailure(result) && result.failure._tag).toBe("ClipboardRebindRequired");
        expect(yield* editor.project.get()).toEqual(before);
        const pasted = yield* editor.fragment.paste({
          graphID: "destination",
          text: eventText,
          position: { x: 0, y: 0 },
          bindings: [{ nodeId: "event", target: "emit:new" }],
        });
        expect(pasted.nodes[1]!.schema.schema).toBe("emit:new");
        expect(pasted.nodes[1]!.inputDefaults).toEqual({ "field:new": "preserved" });
        expect(pasted.connections[0]!.inIoId).toBe("field:new");
      }),
  );
  it.effect(
    "pastes and cuts a full fragment with fresh IDs, one event and persisted connections",
    () =>
      Effect.gen(function* () {
        const editor = yield* setup;
        const events = yield* EditorEvents.Service;
        const subscription = yield* events.subscribe;
        const pasted = yield* events.withActor(
          editor.fragment.paste({ graphID: "destination", text, position: { x: 100, y: 200 } }),
          { type: "CLIENT", id: "author" },
        );
        expect(yield* PubSub.take(subscription)).toEqual(pasted);
        expect(pasted.nodes.map((node) => node.position)).toEqual([
          { x: 100, y: 200 },
          { x: 183, y: 200 },
        ]);
        expect(pasted.nodes[0]).toMatchObject({
          properties: { label: "kept" },
          inputDefaults: { text: "input" },
          foldPins: true,
        });
        expect(pasted.nodes[0]!.id).not.toBe("a");
        expect(pasted.connections[0]).toMatchObject({
          outNodeId: pasted.nodes[0]!.id,
          inNodeId: pasted.nodes[1]!.id,
        });
        expect(pasted.connections[0]!.id).not.toBe("edge");
        expect(EditorRpc.isEventVisibleTo(pasted, "author")).toBe(false);
        expect(EditorRpc.isEventVisibleTo(pasted, "collaborator")).toBe(true);
        expect(
          Schema.decodeUnknownSync(EditorEventsSchema)(
            Schema.encodeUnknownSync(EditorEventsSchema)(pasted),
          ),
        ).toEqual(pasted);
        const graph = (yield* editor.project.get()).graphs.destination!;
        expect(Object.values(graph.nodes)).toEqual(pasted.nodes);
        expect(graph.connections).toEqual(pasted.connections);
        const deleted = yield* editor.fragment.delete({
          graphID: "destination",
          nodeIds: [pasted.nodes[0]!.id],
        });
        expect(yield* PubSub.take(subscription)).toEqual(deleted);
        expect(deleted.deletedConnectionIds).toEqual([pasted.connections[0]!.id]);
        expect((yield* editor.project.get()).graphs.destination!.connections).toEqual([]);
        expect(Object.keys((yield* editor.project.get()).graphs.destination!.nodes)).toEqual([
          pasted.nodes[1]!.id,
        ]);
      }),
  );

  for (const [name, invalid] of [
    ["malformed", "{"],
    ["version", JSON.stringify({ ...fragment, version: 2 })],
    ["unsafe", text.replace('"label":"kept"', '"__proto__":{}')],
    [
      "duplicate nodes",
      JSON.stringify({ ...fragment, nodes: [fragment.nodes[0], fragment.nodes[0]] }),
    ],
    [
      "external connection",
      JSON.stringify({
        ...fragment,
        connections: [{ ...fragment.connections[0], inNodeId: "outside" }],
      }),
    ],
    [
      "cardinality",
      JSON.stringify({
        ...fragment,
        connections: [fragment.connections[0], { ...fragment.connections[0], id: "second" }],
      }),
    ],
    [
      "ports",
      JSON.stringify({
        ...fragment,
        connections: [{ ...fragment.connections[0], inIoId: "missing" }],
      }),
    ],
    [
      "kind",
      JSON.stringify({
        ...fragment,
        connections: [{ ...fragment.connections[0], inIoId: "exec" }],
      }),
    ],
    ["property", text.replace('"label":"kept"', '"label":42')],
    ["undeclared property", text.replace('"label":"kept"', '"unknown":"value"')],
    ["input codec", text.replace('"text":"input"', '"text":42')],
    ["resources", text.replace('"label":"kept"', '"account":"same-name"')],
    ["missing schema", text.replace('"schema":"node"', '"schema":"missing"')],
    ["position", text.replace('"x":11', '"x":1e999')],
    ["size", " ".repeat(Clipboard.maxBytes + 1)],
  ])
    it.effect(`rejects ${name} without partial mutation`, () =>
      Effect.gen(function* () {
        const editor = yield* setup;
        const before = yield* editor.project.get();
        const result = yield* editor.fragment
          .paste({ graphID: "destination", text: invalid!, position: { x: 0, y: 0 } })
          .pipe(Effect.result);
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result))
          expect(result.failure._tag).toBe(
            name === "resources" || name === "missing schema"
              ? "ClipboardRebindRequired"
              : "InvalidClipboardFragment",
          );
        expect(yield* editor.project.get()).toEqual(before);
      }),
    );

  it.effect("rejects internal nodes on paste and cut but permits ordinary event schemas", () =>
    Effect.gen(function* () {
      const editor = yield* setup;
      const packages = yield* Packages.Service;
      yield* packages.loadPackage({
        ...pkg,
        schemas: pkg.schemas.map((schema) => ({ ...schema, type: "event", internal: false })),
      });
      const pasted = yield* editor.fragment.paste({
        graphID: "destination",
        text,
        position: { x: 0, y: 0 },
      });
      yield* packages.loadPackage({
        ...pkg,
        schemas: pkg.schemas.map((schema) => ({ ...schema, internal: true })),
      });
      const before = yield* editor.project.get();
      expect(
        Result.isFailure(
          yield* editor.fragment
            .paste({ graphID: "destination", text, position: { x: 0, y: 0 } })
            .pipe(Effect.result),
        ),
      ).toBe(true);
      expect(
        Result.isFailure(
          yield* editor.fragment
            .delete({ graphID: "destination", nodeIds: pasted.nodes.map((node) => node.id) })
            .pipe(Effect.result),
        ),
      ).toBe(true);
      expect(yield* editor.project.get()).toEqual(before);
    }),
  );
});

const EditorEventsSchema = Schema.Union([EditorEvent.FragmentPasted, EditorEvent.FragmentDeleted]);

it.effect("failed persistence publishes no fragment and does not invoke per-node writes", () =>
  Effect.gen(function* () {
    const memory = yield* Persistence.Service;
    let saves = 0;
    const failing = {
      ...memory,
      saveGraph: () => {
        saves++;
        return Effect.fail(new PersistenceError({ cause: "disk failure" }));
      },
    };
    const program = Effect.gen(function* () {
      const editor = yield* setup;
      const events = yield* EditorEvents.Service;
      const subscription = yield* events.subscribe;
      const before = yield* editor.project.get();
      expect(
        Result.isFailure(
          yield* editor.fragment
            .paste({ graphID: "destination", text, position: { x: 0, y: 0 } })
            .pipe(Effect.result),
        ),
      ).toBe(true);
      expect(saves).toBe(1);
      expect(yield* PubSub.takeUpTo(subscription, 10)).toEqual([]);
      expect(yield* editor.project.get()).toEqual(before);
    });
    yield* program.pipe(
      Effect.provide(
        Editor.defaultLayer.pipe(
          Layer.provideMerge(Packages.defaultLayer),
          Layer.provide(Layer.succeed(Persistence.Service, failing)),
        ),
      ),
    );
  }).pipe(Effect.provide(Persistence.layerMemory)),
);

it("clipboard RPCs require write access", () => {
  expect(EditorRpc.requiresWriteAccess("PasteFragment")).toBe(true);
  expect(EditorRpc.requiresWriteAccess("DeleteFragment")).toBe(true);
});
