import { describe, expect, it } from "@effect/vitest";
import {
  Actor,
  ConnectionId,
  CustomTypes,
  GraphId,
  IoId,
  Node,
  NodeId,
  Package,
  PackageId,
  Project,
  SchemaId,
  TypeDefinition,
} from "@macrograph/core";
import { Engine, Module } from "@macrograph/module";
import ListModule from "@macrograph/module-list";
import { DataType } from "@macrograph/module/DataType";
import { Persistence, PersistenceError } from "@macrograph/persistence";
import { DateTime, Deferred, Effect, Fiber, Layer, Option, PubSub, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import { RpcTest } from "effect/unstable/rpc";

import {
  Editor,
  EditorAccess,
  EditorEvent,
  EditorEvents,
  EditorRpc,
  Packages,
  Presence,
} from "../src/index.ts";
import { apply } from "../src/projectEventProjection.ts";

const personId = DataType.DefinitionId.make("person");
const groupId = DataType.DefinitionId.make("group");
const teamId = DataType.DefinitionId.make("team");
const person: DataType.Definition = {
  _tag: "Struct",
  id: personId,
  name: "Person",
  fields: [{ name: "name", type: DataType.String }],
};
const definitions: DataType.Definitions = {
  person,
  group: {
    _tag: "Struct",
    id: groupId,
    name: "Group",
    fields: [{ name: "people", type: DataType.List(DataType.Custom(personId)) }],
  },
  team: {
    _tag: "Struct",
    id: teamId,
    name: "Team",
    fields: [{ name: "group", type: DataType.Option(DataType.Custom(groupId)) }],
  },
};
const pkg: Package.Model = {
  id: PackageId.make("test"),
  name: "Test",
  resources: [],
  schemas: [
    {
      id: SchemaId.make("sink"),
      name: "Sink",
      type: "pure",
      properties: [],
      dataInputs: [{ id: IoId.make("value"), type: DataType.Custom(teamId) }],
      dataOutputs: [],
      executionInputs: [],
      executionOutputs: [],
    },
    {
      id: SchemaId.make("string"),
      name: "String",
      type: "pure",
      properties: [],
      dataInputs: [{ id: IoId.make("value"), type: DataType.String }],
      dataOutputs: [],
      executionInputs: [],
      executionOutputs: [],
    },
    {
      id: SchemaId.make("person-source"),
      name: "Person Source",
      type: "pure",
      properties: [],
      dataInputs: [],
      dataOutputs: [{ id: IoId.make("value"), type: DataType.Custom(personId) }],
      executionInputs: [],
      executionOutputs: [],
    },
  ],
};
const generatedRef = (name: string) => {
  const schema = CustomTypes.packageModel.schemas.find((schema) => schema.name === name);
  if (schema === undefined) throw new Error(`Missing test schema ${name}`);
  return { package: CustomTypes.packageId, schema: schema.id };
};
const node = (
  id: string,
  schema: Node.Model["schema"],
  inputDefaults: Node.Model["inputDefaults"] = {},
  properties: Node.Model["properties"] = {},
): Node.Model => ({
  id: NodeId.make(id),
  name: id,
  schema,
  inputDefaults,
  properties,
  foldPins: false,
  position: { x: 0, y: 0 },
});
const make = generatedRef("Update Struct");
const breakRef = generatedRef("Break Struct");
const field = IoId.make('field:"name"');
const sourceAnchor = {
  id: ConnectionId.make("source-anchor"),
  outNodeId: "source",
  outIo: { _tag: "Port" as const, id: IoId.make("value") },
  inNodeId: "make",
  inIoId: IoId.make("value"),
};
const breakAnchor = {
  id: ConnectionId.make("anchor"),
  outNodeId: "make",
  outIo: { _tag: "Port" as const, id: IoId.make("value") },
  inNodeId: "break",
  inIoId: IoId.make("value"),
};
const anchoredConnections = [sourceAnchor, breakAnchor];
const seed: Project.Model = {
  name: "Types",
  types: definitions,
  constants: {},
  engines: {},
  functions: {},
  graphs: {
    first: {
      canvas: {
        id: GraphId.make("first"),
        name: "First",
        nodes: {
          make: node("make", make, { [field]: { _tag: "Some", value: "Ada" } }),
          source: node("source", { package: pkg.id, schema: SchemaId.make("person-source") }),
          break: node("break", breakRef, { value: { _type: "person", name: "Ada" } }),
          string: node("string", { package: pkg.id, schema: SchemaId.make("string") }),
        },
        connections: [
          sourceAnchor,
          breakAnchor,
          {
            id: ConnectionId.make("wire"),
            outNodeId: NodeId.make("break"),
            outIo: { _tag: "Port" as const, id: field },
            inNodeId: NodeId.make("string"),
            inIoId: IoId.make("value"),
          },
        ],
      },
    },
    second: {
      canvas: {
        id: GraphId.make("second"),
        name: "Second",
        nodes: {
          sink: node("sink", { package: pkg.id, schema: SchemaId.make("sink") }),
          property: node(
            "property",
            { package: pkg.id, schema: SchemaId.make("string") },
            {},
            { type: JSON.stringify(DataType.List(DataType.Option(DataType.Custom(personId)))) },
          ),
        },
        connections: [],
      },
    },
  },
};
const seedCanvases = Project.canvases(seed);
const seedLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* (yield* Persistence.Service).saveProject(seed);
    yield* (yield* Packages.Service).loadPackage(pkg);
  }),
);
const testLayer = Editor.defaultLayer.pipe(
  Layer.provide(seedLayer),
  Layer.provideMerge(Packages.defaultLayer),
  Layer.provideMerge(Persistence.layerMemory),
);
const removingField: TypeDefinition.Change = {
  _tag: "Upsert",
  definition: { ...person, fields: [] },
};
const fresh: TypeDefinition.Change = {
  _tag: "Upsert",
  definition: {
    _tag: "Struct",
    id: DataType.DefinitionId.make("fresh"),
    name: "Fresh",
    fields: [],
  },
};
const mutate = (editor: Editor.Interface, change: TypeDefinition.Change) =>
  editor.typeDefinition
    .preview(change)
    .pipe(Effect.flatMap((impact) => editor.typeDefinition.confirm({ token: impact.token })));

describe("type authoring preserve-invalid", () => {
  it.effect("infers Update Struct and exposes None defaults for every update field", () =>
    Effect.gen(function* () {
      const editor = yield* Editor.Service;
      const project = yield* editor.project.get();
      const rendered = yield* editor.project.rendered();
      const update = Project.canvases(project).first!.nodes.make!;
      const io = rendered.graphs.first!.nodes.make!.io;
      expect(update.properties).toEqual({});
      expect(io.dataInputs).toEqual([
        { id: "value", type: DataType.Custom(personId) },
        {
          id: field,
          name: "name",
          type: DataType.Option(DataType.String),
          defaultValue: { _tag: "None" },
        },
      ]);
      yield* editor.node.setInputDefault({
        graphID: "first",
        nodeID: update.id,
        input: field,
        value: Option.some("Grace"),
      });
      const snapshot = yield* editor.project.snapshot();
      expect(snapshot.project.graphs.first!.nodes[update.id]!.inputDefaults[field]).toEqual({
        _tag: "Some",
        value: "Grace",
      });
      expect(snapshot.nodeIO.first![update.id]!.dataInputs[1]).toEqual(io.dataInputs[1]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects the removed target type property", () =>
    Effect.gen(function* () {
      const editor = yield* Editor.Service;
      const error = yield* Effect.flip(
        editor.node.setProperty({
          graphID: "first",
          nodeID: "make",
          property: "type",
          value: groupId,
        }),
      );
      expect(error._tag).toBe("InvalidPropertyError");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps unresolved update IO renderable when a nested dependency is deleted", () =>
    Effect.gen(function* () {
      const editor = yield* Editor.Service;
      const created = yield* editor.node.create({
        graphID: "second",
        node: { schema: generatedRef("Update Struct") },
      });
      const event = yield* mutate(editor, { _tag: "Delete", id: personId });
      const io = event.nodeIO.second![created.node.id]!;
      expect(io.dataInputs).toEqual([{ id: "value", type: DataType.Wildcard("Struct") }]);
      expect(TypeDefinition.nodeDiagnostics(created.node, io, event.types)).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "wildcard list declarations stay stable and retain custom defaults after type deletion",
    () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        yield* editor.module(ListModule);
        const persistence = yield* Persistence.Service;
        const create = node(
          "list-create",
          { package: PackageId.make("list"), schema: SchemaId.make("ListCreate") },
          { "value-0": [] },
          { number: 1 },
        );
        const push = node(
          "list-push",
          { package: PackageId.make("list"), schema: SchemaId.make("PushListValue") },
          { list: [{ _type: "person", name: "Ada" }], value: { _type: "person", name: "Grace" } },
        );
        yield* persistence.saveNode("second", create);
        yield* persistence.saveNode("second", push);
        const snapshot = yield* editor.project.snapshot();
        expect(snapshot.nodeIO.second![create.id]!.dataInputs[0]!.type).toEqual(
          DataType.Wildcard("Item"),
        );
        expect(snapshot.nodeIO.second![create.id]!.dataInputs[0]!.defaultValue).toBeUndefined();
        expect(
          snapshot.nodeIO.second![push.id]!.dataInputs.find((input) => input.id === "list")!
            .defaultValue,
        ).toEqual([]);
        expect((yield* editor.project.rendered()).graphs.second!.nodes[push.id]!.io).toEqual(
          snapshot.nodeIO.second![push.id],
        );
        const impact = yield* editor.typeDefinition.preview({ _tag: "Delete", id: personId });
        expect(impact.nodes.find((entry) => entry.nodeId === push.id)!.reasons).toContain(
          "Missing type person",
        );
        const packages = yield* Packages.Service;
        const { person: _, ...proposed } = snapshot.project.types;
        const proposedPushIO = yield* packages.getNodeIO(push.schema, push.properties, proposed);
        expect(
          proposedPushIO.dataInputs.find((input) => input.id === "list")!.defaultValue,
        ).toEqual([]);
        expect(yield* packages.getNodeIO(push.schema, push.properties)).toEqual(
          snapshot.nodeIO.second![push.id],
        );
        expect(Project.canvases(yield* persistence.loadProject())).toEqual(snapshot.project.graphs);
        const event = yield* editor.typeDefinition.confirm({ token: impact.token });
        expect(event.nodeIO.second![push.id]).toEqual(proposedPushIO);
        const deleted = yield* editor.project.snapshot();
        expect(deleted.project.graphs.first!.connections).toEqual(anchoredConnections);
        expect(event.deletedConnectionIds).toEqual({ first: ["wire"] });
        expect(deleted.nodeIO).toEqual(event.nodeIO);
        expect(deleted.nodeIO.second![create.id]!.dataInputs[0]!.defaultValue).toBeUndefined();
        expect(
          deleted.nodeIO.second![push.id]!.dataInputs.find((input) => input.id === "list")!
            .defaultValue,
        ).toEqual([]);
        expect(
          TypeDefinition.nodeDiagnostics(
            push,
            deleted.nodeIO.second![push.id]!,
            deleted.project.types,
          ),
        ).toContain("Missing type person");
        expect(
          (yield* editor.project.rendered()).graphs.second!.nodes[push.id]!.inputDefaults,
        ).toEqual(push.inputDefaults);
        yield* mutate(editor, { _tag: "Upsert", definition: person });
        expect(
          (yield* editor.project.snapshot()).nodeIO.second![push.id]!.dataInputs.find(
            (input) => input.id === "list",
          )!.defaultValue,
        ).toEqual([]);
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "rejects cyclic and excessively deep authored descriptors as typed errors before recursive decoding",
    () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const cyclic: { _tag: "List"; item: DataType.Any } = {
          _tag: "List",
          item: DataType.String,
        };
        cyclic.item = cyclic;
        let deep: DataType.Any = DataType.String;
        for (let i = 0; i < 1000; i++) deep = DataType.Option(deep);
        for (const type of [cyclic, deep]) {
          const change: TypeDefinition.Change = {
            _tag: "Upsert",
            definition: { ...person, fields: [{ name: "value", type }] },
          };
          expect(Schema.decodeUnknownResult(TypeDefinition.Change)(change)._tag).toBe("Failure");
          expect(TypeDefinition.validateChange(definitions, change)[0]!._tag).toBe(
            "InvalidTypeDefinition",
          );
          expect((yield* Effect.flip(editor.typeDefinition.preview(change)))._tag).toBe(
            "InvalidTypeDefinition",
          );
          const rpc = EditorRpc.EditorRpcs.requests.get("PreviewTypeDefinition")!;
          expect(Schema.decodeUnknownResult(rpc.payloadSchema)({ change })._tag).toBe("Failure");
        }
        expect((yield* editor.project.get()).graphs).toEqual(seed.graphs);
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "kind changes preserve incompatible nodes and required dependents while removing invalid wires",
    () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const dependent: DataType.Definition = {
          _tag: "Struct",
          id: DataType.DefinitionId.make("required"),
          name: "Required",
          fields: [{ name: "person", type: DataType.Custom(personId) }],
        };
        yield* mutate(editor, { _tag: "Upsert", definition: dependent });
        const change: TypeDefinition.Change = {
          _tag: "Upsert",
          definition: {
            _tag: "Enum",
            id: personId,
            name: "Person",
            variants: [
              { name: "Empty", fields: [] },
              {
                name: "Nested",
                fields: [{ name: "required", type: DataType.Custom(dependent.id) }],
              },
            ],
          },
        };
        const impact = yield* editor.typeDefinition.preview(change);
        expect(impact.affectedTypes).toContain("required");
        const event = yield* editor.typeDefinition.confirm({ token: impact.token });
        expect(event.types.required).toEqual(dependent);
        expect(Project.canvases(yield* editor.project.get()).first!.connections).toEqual(
          anchoredConnections,
        );
        expect(event.nodeIO.first!.make!.dataInputs).toEqual([
          { id: "value", type: DataType.Wildcard("Struct") },
        ]);
        expect(TypeDefinition.validate(event.types)).toEqual([]);
        const unsafe: TypeDefinition.Change = {
          _tag: "Upsert",
          definition: {
            _tag: "Struct",
            id: personId,
            name: "Person",
            fields: [{ name: "required", type: DataType.Custom(dependent.id) }],
          },
        };
        expect(
          TypeDefinition.validateChange(event.types, unsafe).some(
            (error) => error.id === personId && error.reason.includes("no finite value"),
          ),
        ).toBe(true);
        expect((yield* Effect.flip(editor.typeDefinition.preview(unsafe)))._tag).toBe(
          "InvalidTypeDefinition",
        );
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect("unanchored wildcard nodes do not retain a hidden type dependency", () =>
    Effect.gen(function* () {
      const editor = yield* Editor.Service;
      const id = DataType.DefinitionId.make("empty");
      yield* mutate(editor, {
        _tag: "Upsert",
        definition: { _tag: "Struct", id, name: "Empty", fields: [] },
      });
      const catalog = (yield* (yield* Packages.Service).getPackages()).find(
        (pkg) => pkg.id === CustomTypes.packageId,
      )!;
      const created: string[] = [];
      for (const name of ["Update Struct", "Break Struct"]) {
        const schema = catalog.schemas.find((schema) => schema.name === name)!;
        created.push(
          (yield* editor.node.create({
            graphID: "second",
            node: {
              schema: { package: CustomTypes.packageId, schema: schema.id },
              properties: {},
            },
          })).node.id,
        );
      }
      yield* editor.connection.create({
        graphID: "second",
        connection: {
          outNodeId: created[0]!,
          outIo: { _tag: "Port", id: IoId.make("value") },
          inNodeId: created[1]!,
          inIoId: IoId.make("value"),
        },
      });
      const before = yield* editor.project.get();
      const impact = yield* editor.typeDefinition.preview({ _tag: "Delete", id });
      expect(impact.nodes).toEqual([]);
      yield* editor.typeDefinition.confirm({ token: impact.token });
      expect(Project.canvases(yield* editor.project.get()).second!.nodes).toEqual(
        Project.canvases(before).second!.nodes,
      );
      expect(Project.canvases(yield* editor.project.get()).second!.connections).toHaveLength(1);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "preview is read-only and includes transitive types, all graphs, properties, defaults and wire peers",
    () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const packages = yield* Packages.Service;
        const before = yield* packages.getPackages();
        const impact = yield* editor.typeDefinition.preview(removingField);
        expect(impact.affectedTypes).toEqual(["group", "team"]);
        expect(impact.nodes.map((n) => `${n.graphId}/${n.nodeId}`)).toEqual([
          "first/break",
          "first/make",
          "first/source",
          "first/string",
          "second/property",
          "second/sink",
        ]);
        expect(
          impact.nodes
            .find((n) => n.nodeId === "make")!
            .reasons.some((r) => r.includes("Orphan default")),
        ).toBe(true);
        expect(
          impact.nodes
            .find((n) => n.nodeId === "break")!
            .reasons.some((r) => r.includes("Invalid default")),
        ).toBe(true);
        expect(
          impact.nodes
            .find((n) => n.nodeId === "string")!
            .reasons.some((r) => r.includes("will be removed")),
        ).toBe(true);
        expect(yield* (yield* Persistence.Service).loadProject()).toEqual(seed);
        expect(yield* packages.getPackages()).toEqual(before);
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "confirmation removes invalid wires and emits attributable serializable collaboration IO",
    () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* EditorEvents.Service;
        const subscription = yield* events.subscribe;
        const actor: Actor.Model = { type: "CLIENT", id: "alice" };
        const event = yield* events.withActor(mutate(editor, removingField), actor);
        expect(yield* PubSub.take(subscription)).toEqual(event);
        expect(event.actor).toEqual(actor);
        expect(EditorRpc.isEventVisibleTo(event, "alice")).toBe(false);
        expect(EditorRpc.isEventVisibleTo(event, "bob")).toBe(true);
        expect(
          Schema.decodeUnknownSync(EditorEvent.TypeDefinitionsUpdated)(
            JSON.parse(JSON.stringify(event)),
          ),
        ).toEqual(event);
        const project = yield* editor.project.get();
        expect(Project.canvases(project).first!.connections).toEqual(anchoredConnections);
        expect(event.deletedConnectionIds).toEqual({ first: ["wire"] });
        expect(event.nodeIO.first!.make!.dataInputs).toEqual([
          { id: "value", type: DataType.Wildcard("Struct") },
        ]);
        expect((yield* editor.project.snapshot()).nodeIO).toEqual(event.nodeIO);
        expect(
          TypeDefinition.nodeDiagnostics(
            Project.canvases(project).first!.nodes.break!,
            event.nodeIO.first!.break!,
            project.types,
          ).some((r) => r.includes("Invalid default")),
        ).toBe(true);
        yield* apply(yield* Persistence.Service, event);
        expect(Project.canvases(yield* editor.project.get()).first!.connections).toEqual(
          anchoredConnections,
        );
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "delete keeps dependent definitions invalid, supports orphan clear, and permits unrelated authoring/repair",
    () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const event = yield* mutate(editor, { _tag: "Delete", id: personId });
        expect(Object.keys(event.types)).toEqual(["group", "team"]);
        expect(Project.canvases(yield* editor.project.get()).first!.connections).toEqual(
          anchoredConnections,
        );
        expect(
          (yield* editor.project.rendered()).graphs.first!.nodes.make!.io.dataOutputs[0]!.type,
        ).toEqual(DataType.Wildcard("Struct"));
        const diagnostics = TypeDefinition.nodeDiagnostics(
          seedCanvases.second!.nodes.sink!,
          event.nodeIO.second!.sink!,
          event.types,
        );
        expect(diagnostics).toContain("Missing type person");
        expect(
          TypeDefinition.nodeDiagnostics(
            seedCanvases.first!.nodes.make!,
            event.nodeIO.first!.make!,
            event.types,
          ).some((r) => r.includes("Orphan default")),
        ).toBe(true);
        yield* editor.node.clearInputDefault({ graphID: "first", nodeID: "make", input: field });
        expect(
          Project.canvases(yield* editor.project.get()).first!.nodes.make!.inputDefaults,
        ).toEqual({});
        expect(Project.canvases(yield* editor.project.get()).first!.connections).toEqual(
          anchoredConnections,
        );
        yield* mutate(editor, fresh);
        yield* mutate(editor, { _tag: "Upsert", definition: person });
        const repaired = yield* editor.project.snapshot();
        expect(
          TypeDefinition.nodeDiagnostics(
            repaired.project.graphs.second!.nodes.sink!,
            repaired.nodeIO.second!.sink!,
            repaired.project.types,
          ),
        ).toEqual([]);
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect("field type replacement retains defaults and removes mismatched connections", () =>
    Effect.gen(function* () {
      const editor = yield* Editor.Service;
      const event = yield* mutate(editor, {
        _tag: "Upsert",
        definition: { ...person, fields: [{ name: "name", type: DataType.Int }] },
      });
      expect(Project.canvases(yield* editor.project.get()).first!.connections).toEqual(
        anchoredConnections,
      );
      expect(
        TypeDefinition.nodeDiagnostics(
          seedCanvases.first!.nodes.make!,
          event.nodeIO.first!.make!,
          event.types,
        ).some((r) => r.includes("Invalid default")),
      ).toBe(true);
      yield* editor.node.setInputDefault({
        graphID: "first",
        nodeID: "make",
        input: field,
        value: Option.some(42),
      });
      yield* editor.node.setInputDefault({
        graphID: "first",
        nodeID: "break",
        input: "value",
        value: { _type: "person", name: 42 },
      });
      const repaired = yield* editor.project.snapshot();
      expect(
        TypeDefinition.nodeDiagnostics(
          repaired.project.graphs.first!.nodes.make!,
          repaired.nodeIO.first!.make!,
          repaired.project.types,
        ),
      ).toEqual([]);
      expect(repaired.project.graphs.first!.connections).toEqual(anchoredConnections);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("later property edits retain invalid type data after wires are removed", () =>
    Effect.gen(function* () {
      const editor = yield* Editor.Service;
      yield* mutate(editor, removingField);
      yield* editor.node.setProperty({
        graphID: "first",
        nodeID: "string",
        property: "label",
        value: "repair context",
      });
      expect(Project.canvases(yield* editor.project.get()).first!.connections).toEqual(
        anchoredConnections,
      );
      const event = yield* editor.node.setProperty({
        graphID: "second",
        nodeID: "property",
        property: "type",
        value: "String",
      });
      expect(event.deletedConnectionIds).toEqual([]);
      expect(
        Project.canvases(yield* editor.project.get()).first!.nodes.make!.inputDefaults,
      ).toEqual(seedCanvases.first!.nodes.make!.inputDefaults);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "enum variant removal preserves construct nodes and obsolete payloads while removing wires",
    () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const enumId = DataType.DefinitionId.make("result");
        const definition: DataType.Definition = {
          _tag: "Enum",
          id: enumId,
          name: "Result",
          variants: [
            { name: "Empty", fields: [] },
            { name: "Found", fields: [{ name: "name", type: DataType.String }] },
          ],
        };
        yield* mutate(editor, { _tag: "Upsert", definition });
        yield* editor.module(
          Module.make({
            id: "enum-test",
            effect: (context) =>
              context.schema.register({
                id: "anchor",
                type: "pure",
                io: (io) => ({ value: io.data.in("value", DataType.Custom(enumId)) }),
                run: () => Effect.void,
              }),
          }),
        );
        const catalog = (yield* (yield* Packages.Service).getPackages()).find(
          (pkg) => pkg.id === CustomTypes.packageId,
        )!;
        const constructSchema = catalog.schemas.find((s) => s.name === "Construct Enum")!;
        const matchSchema = catalog.schemas.find((s) => s.name === "Match Enum")!;
        const construct = yield* editor.node.create({
          graphID: "second",
          node: {
            schema: { package: CustomTypes.packageId, schema: constructSchema.id },
            properties: { variant: "Found" },
          },
        });
        const match = yield* editor.node.create({
          graphID: "second",
          node: {
            schema: { package: CustomTypes.packageId, schema: matchSchema.id },
            properties: {},
          },
        });
        const anchor = yield* editor.node.create({
          graphID: "second",
          node: {
            schema: { package: PackageId.make("enum-test"), schema: SchemaId.make("anchor") },
          },
        });
        yield* editor.connection.create({
          graphID: "second",
          connection: {
            outNodeId: construct.node.id,
            outIo: { _tag: "Port" as const, id: IoId.make("value") },
            inNodeId: anchor.node.id,
            inIoId: IoId.make("value"),
          },
        });
        yield* editor.node.setInputDefault({
          graphID: "second",
          nodeID: construct.node.id,
          input: IoId.make('field:"name"'),
          value: "Ada",
        });
        const wire = yield* editor.connection.create({
          graphID: "second",
          connection: {
            outNodeId: construct.node.id,
            outIo: { _tag: "Port" as const, id: construct.io.dataOutputs[0]!.id },
            inNodeId: match.node.id,
            inIoId: IoId.make("value"),
          },
        });
        const before = yield* editor.project.get();
        const impact = yield* editor.typeDefinition.preview({
          _tag: "Upsert",
          definition: { ...definition, variants: [{ name: "Empty", fields: [] }] },
        });
        expect(
          impact.nodes.some(
            (n) =>
              n.nodeId === construct.node.id && n.reasons.some((r) => r.includes("Orphan default")),
          ),
        ).toBe(true);
        yield* editor.typeDefinition.confirm({ token: impact.token });
        expect((yield* editor.project.get()).graphs.first).toEqual(before.graphs.first);
        expect(Project.canvases(yield* editor.project.get()).second!.connections).toContainEqual(
          wire.connection,
        );
        yield* editor.node.clearInputDefault({
          graphID: "second",
          nodeID: construct.node.id,
          input: IoId.make('field:"name"'),
        });
      }).pipe(Effect.provide(testLayer)),
  );

  it("diagnoses nested JSON DateTime/List/Option values strictly without blocking unrelated invalid definitions", () => {
    const id = DataType.DefinitionId.make("record");
    const registry: DataType.Definitions = {
      record: {
        _tag: "Struct",
        id,
        name: "Record",
        fields: [
          { name: "when", type: DataType.DateTime },
          { name: "people", type: DataType.List(DataType.Option(DataType.Custom(personId))) },
        ],
      },
      person,
      unused: {
        _tag: "Struct",
        id: DataType.DefinitionId.make("unused"),
        name: "Unused",
        fields: [{ name: "missing", type: DataType.Custom(DataType.DefinitionId.make("absent")) }],
      },
    };
    const type = DataType.Custom(id);
    const io = {
      dataInputs: [{ id: IoId.make("value"), type }],
      dataOutputs: [],
      executionInputs: [],
      executionOutputs: [],
    };
    const value = Schema.encodeUnknownSync(DataType.JsonValueSchema(type, registry))({
      _type: "record",
      when: DateTime.makeUnsafe("2026-08-31T00:00:00Z"),
      people: [Option.some({ _type: "person", name: "Ada" })],
    });
    const model = node("record", { package: pkg.id, schema: SchemaId.make("sink") }, { value });
    expect(TypeDefinition.nodeDiagnostics(model, io, registry)).toEqual([]);
    const obsolete = { ...registry, person: { ...person, fields: [] } };
    expect(
      TypeDefinition.nodeDiagnostics(model, io, obsolete).some((r) =>
        r.includes("obsolete fields"),
      ),
    ).toBe(true);
    expect(model.inputDefaults.value).toEqual(value);
    const { person: _, ...missing } = registry;
    expect(TypeDefinition.nodeDiagnostics(model, io, missing)).toContain("Missing type person");
    const recursive: DataType.Definitions = {
      record: { _tag: "Struct", id, name: "Loop", fields: [{ name: "next", type }] },
    };
    expect(
      TypeDefinition.nodeDiagnostics(node("loop", model.schema), io, recursive).some((r) =>
        r.includes("no finite value"),
      ),
    ).toBe(true);
  });

  it.effect(
    "stale confirmation observes graph/property/default/wire/type/project changes, not just affected nodes",
    () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const persistence = yield* Persistence.Service;
        const changes: readonly ((project: Project.Model) => Project.Model)[] = [
          (p) => ({ ...p, name: "changed" }),
          (p) => ({ ...p, engines: { engine: { state: true } } }),
          (p) => ({
            ...p,
            graphs: {
              ...p.graphs,
              second: {
                ...p.graphs.second!,
                canvas: { ...p.graphs.second!.canvas, name: "changed" },
              },
            },
          }),
          (p) => ({
            ...p,
            graphs: {
              ...p.graphs,
              first: {
                ...p.graphs.first!,
                canvas: { ...p.graphs.first!.canvas, connections: [] },
              },
            },
          }),
          (p) => ({
            ...p,
            graphs: {
              ...p.graphs,
              second: {
                ...p.graphs.second!,
                canvas: {
                  ...p.graphs.second!.canvas,
                  nodes: {
                    ...p.graphs.second!.canvas.nodes,
                    property: {
                      ...p.graphs.second!.canvas.nodes.property!,
                      properties: { type: "Int" },
                    },
                  },
                },
              },
            },
          }),
          (p) => ({
            ...p,
            graphs: {
              ...p.graphs,
              first: {
                ...p.graphs.first!,
                canvas: {
                  ...p.graphs.first!.canvas,
                  nodes: {
                    ...p.graphs.first!.canvas.nodes,
                    make: {
                      ...p.graphs.first!.canvas.nodes.make!,
                      inputDefaults: { [field]: "Grace" },
                    },
                  },
                },
              },
            },
          }),
          (p) => ({ ...p, types: { ...p.types, person: { ...person, name: "Renamed" } } }),
        ];
        for (const change of changes) {
          yield* persistence.saveProject(seed);
          yield* editor.project.get();
          const impact = yield* editor.typeDefinition.preview(removingField);
          const modified = change(seed);
          yield* persistence.saveProject(modified);
          expect(
            (yield* Effect.flip(editor.typeDefinition.confirm({ token: impact.token })))._tag,
          ).toBe("StalePreviewError");
          expect(yield* persistence.loadProject()).toEqual(modified);
        }
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect("signed tokens expire, reject tampering, and serialize concurrent confirmation", () =>
    Effect.gen(function* () {
      const editor = yield* Editor.Service;
      expect((yield* Effect.flip(editor.typeDefinition.confirm({ token: "guess" })))._tag).toBe(
        "StalePreviewError",
      );
      const tampered = yield* editor.typeDefinition.preview(fresh);
      const replacement = tampered.token.endsWith("a") ? "b" : "a";
      expect(
        (yield* Effect.flip(
          editor.typeDefinition.confirm({ token: tampered.token.slice(0, -1) + replacement }),
        ))._tag,
      ).toBe("StalePreviewError");
      const expired = yield* editor.typeDefinition.preview(fresh);
      yield* TestClock.adjust("5 minutes");
      expect(
        (yield* Effect.flip(editor.typeDefinition.confirm({ token: expired.token })))._tag,
      ).toBe("StalePreviewError");
      const impact = yield* editor.typeDefinition.preview(fresh);
      expect(impact.nodes).toEqual([]);
      expect(impact.affectedTypes).toEqual([]);
      const results = yield* Effect.all(
        [
          editor.typeDefinition.confirm({ token: impact.token }).pipe(Effect.result),
          editor.typeDefinition.confirm({ token: impact.token }).pipe(Effect.result),
        ],
        { concurrency: "unbounded" },
      );
      expect(results.map((result) => result._tag).sort()).toEqual(["Failure", "Success"]);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "unchanged definitions have no impact and same-state competing proposals cannot overwrite one another",
    () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const unchanged = yield* editor.typeDefinition.preview({
          _tag: "Upsert",
          definition: person,
        });
        expect(unchanged.nodes).toEqual([]);
        expect(unchanged.affectedTypes).toEqual([]);
        const first = yield* editor.typeDefinition.preview(removingField);
        const second = yield* editor.typeDefinition.preview({ _tag: "Delete", id: personId });
        const results = yield* Effect.all(
          [
            editor.typeDefinition.confirm({ token: first.token }).pipe(Effect.result),
            editor.typeDefinition.confirm({ token: second.token }).pipe(Effect.result),
          ],
          { concurrency: "unbounded" },
        );
        expect(results.map((result) => result._tag).sort()).toEqual(["Failure", "Success"]);
        expect(
          Project.canvases(yield* editor.project.get()).first!.connections.some(
            (wire) => wire.id === "wire",
          ),
        ).toBe(false);
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect("keeps previews stateless and invalidates them when package IO changes", () =>
    Effect.gen(function* () {
      const editor = yield* Editor.Service;
      const old = yield* editor.typeDefinition.preview(fresh);
      for (let i = 0; i < 128; i++) yield* editor.typeDefinition.preview(fresh);
      yield* editor.typeDefinition.confirm({ token: old.token });
      const impact = yield* editor.typeDefinition.preview(fresh);
      yield* (yield* Packages.Service).loadPackage({ ...pkg, name: "Replaced" });
      expect(
        (yield* Effect.flip(editor.typeDefinition.confirm({ token: impact.token })))._tag,
      ).toBe("StalePreviewError");
      expect((yield* editor.project.get()).types).toEqual({
        ...definitions,
        fresh: fresh.definition,
      });
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "validates authored names, identities, dangling references and new required recursion without blocking pre-existing dangling types",
    () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const bad: readonly DataType.Definition[] = [
          { ...person, id: DataType.DefinitionId.make("__proto__") },
          { ...person, name: "constructor" },
          { ...person, name: "Group" },
          {
            ...person,
            fields: [
              { name: "name", type: DataType.String },
              { name: "name", type: DataType.Int },
            ],
          },
          { ...person, fields: [{ name: "next", type: DataType.Custom(personId) }] },
          {
            ...person,
            fields: [
              {
                name: "missing",
                type: DataType.List(DataType.Custom(DataType.DefinitionId.make("missing"))),
              },
            ],
          },
          { _tag: "Enum", id: personId, name: "Person", variants: [] },
          {
            _tag: "Enum",
            id: personId,
            name: "Person",
            variants: [{ name: "constructor", fields: [] }],
          },
        ];
        for (const definition of bad)
          expect(
            (yield* Effect.flip(editor.typeDefinition.preview({ _tag: "Upsert", definition })))
              ._tag,
          ).toBe("InvalidTypeDefinition");
        expect(
          (yield* Effect.flip(
            editor.typeDefinition.preview({
              _tag: "Delete",
              id: DataType.DefinitionId.make("absent"),
            }),
          ))._tag,
        ).toBe("TypeDefinitionNotFoundError");
        yield* mutate(editor, { _tag: "Delete", id: personId });
        expect(
          (yield* Effect.flip(
            editor.typeDefinition.preview({
              _tag: "Upsert",
              definition: {
                _tag: "Struct",
                id: DataType.DefinitionId.make("new"),
                name: "New",
                fields: [{ name: "group", type: DataType.Custom(groupId) }],
              },
            }),
          ))._tag,
        ).toBe("InvalidTypeDefinition");
        yield* mutate(editor, fresh);
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect("readers can preview but cannot confirm; editors can confirm", () =>
    Effect.gen(function* () {
      const reader: EditorAccess.ConnectionIdentity = {
        actor: { type: "CLIENT", id: "reader" },
        connectionId: "reader",
        projectId: "project",
        displayName: "Reader",
        canEdit: false,
        canManageCredentials: false,
      };
      yield* EditorRpc.authorize(reader, "PreviewTypeDefinition");
      expect((yield* Effect.flip(EditorRpc.authorize(reader, "ConfirmTypeDefinition")))._tag).toBe(
        "EditorForbidden",
      );
      yield* EditorRpc.authorize({ ...reader, canEdit: true }, "ConfirmTypeDefinition");
      expect(EditorRpc.EditorRpcs.requests.has("PreviewTypeDefinition")).toBe(true);
      expect(EditorRpc.EditorRpcs.requests.has("ConfirmTypeDefinition")).toBe(true);
    }),
  );

  it.effect(
    "actual RPC middleware denies reader confirmation and streams author updates to another collaborator",
    () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* EditorEvents.Service;
        const client = yield* RpcTest.makeClient(EditorRpc.EditorRpcs);
        const preview = yield* client.PreviewTypeDefinition({ change: removingField });
        expect(
          (yield* Effect.flip(client.ConfirmTypeDefinition({ token: preview.token })))._tag,
        ).toBe("EditorForbidden");
        expect((yield* editor.project.get()).graphs).toEqual(seed.graphs);
        const received = yield* Deferred.make<void>();
        const stream = yield* client.ProjectEventsStream().pipe(
          Stream.tap((event) =>
            event._tag === "ProjectSnapshot" ? Deferred.succeed(received, undefined) : Effect.void,
          ),
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Deferred.await(received);
        const event = yield* events.withActor(
          editor.typeDefinition.confirm({ token: preview.token }),
          { type: "CLIENT", id: "author" },
        );
        const results = yield* Fiber.join(stream);
        expect(results[0]!._tag).toBe("ProjectSnapshot");
        expect(results[1]).toEqual(event);
        expect(Project.canvases(yield* client.GetProject({})).first!.connections).toEqual(
          anchoredConnections,
        );
      }).pipe(
        Effect.scoped,
        Effect.provide(
          EditorRpc.handlerLayer.pipe(
            Layer.provideMerge(EditorRpc.connectionMiddlewareLayer),
            Layer.provideMerge(testLayer),
            Layer.provide(Presence.layer),
            Layer.provide(Engine.emptyCredentialsLayer),
            Layer.provide(
              Layer.succeed(EditorAccess.Policy, {
                resolve: () =>
                  Effect.succeed({
                    actor: { type: "CLIENT", id: "reader" },
                    connectionId: "reader",
                    projectId: "project",
                    displayName: "Reader",
                    canEdit: false,
                    canManageCredentials: false,
                  }),
              }),
            ),
          ),
        ),
      ),
  );

  it.effect(
    "failed persistence restores registry and leaves project/defaults/wires untouched",
    () =>
      Effect.gen(function* () {
        const persistence = yield* Persistence.Service;
        yield* persistence.saveProject(seed);
        const failing = Persistence.Service.of({
          ...persistence,
          saveProject: () => Effect.fail(new PersistenceError({ cause: "disk unavailable" })),
        });
        yield* Effect.gen(function* () {
          const editor = yield* Editor.Service;
          const packages = yield* Packages.Service;
          yield* packages.loadPackage(pkg);
          const before = yield* packages.getPackages();
          const impact = yield* editor.typeDefinition.preview(removingField);
          expect(
            (yield* Effect.flip(editor.typeDefinition.confirm({ token: impact.token })))._tag,
          ).toBe("PersistenceError");
          expect(yield* packages.getPackages()).toEqual(before);
          expect(yield* persistence.loadProject()).toEqual(seed);
        }).pipe(
          Effect.provide(
            Editor.defaultLayer.pipe(
              Layer.provideMerge(Packages.defaultLayer),
              Layer.provide(Layer.succeed(Persistence.Service, failing)),
            ),
          ),
        );
      }).pipe(Effect.provide(Persistence.layerMemory)),
  );

  it.effect(
    "reloading into a fresh editor retains missing generated schemas and invalid data for repair",
    () =>
      Effect.gen(function* () {
        const project = yield* Effect.gen(function* () {
          const editor = yield* Editor.Service;
          yield* mutate(editor, { _tag: "Delete", id: personId });
          return yield* editor.project.get();
        }).pipe(Effect.provide(testLayer));
        const reloadSeed = Layer.effectDiscard(
          Effect.gen(function* () {
            yield* (yield* Persistence.Service).saveProject(
              Schema.decodeUnknownSync(Project.Model)(JSON.parse(JSON.stringify(project))),
            );
            yield* (yield* Packages.Service).loadPackage(pkg);
          }),
        );
        yield* Effect.gen(function* () {
          const editor = yield* Editor.Service;
          const snapshot = yield* editor.project.snapshot();
          expect(snapshot.project.graphs.first!.connections).toEqual(anchoredConnections);
          expect(snapshot.nodeIO.first!.make!.dataInputs).toEqual([
            { id: "value", type: DataType.Wildcard("Struct") },
          ]);
          yield* editor.node.clearInputDefault({ graphID: "first", nodeID: "make", input: field });
        }).pipe(
          Effect.provide(
            Editor.defaultLayer.pipe(
              Layer.provide(reloadSeed),
              Layer.provideMerge(Packages.defaultLayer),
              Layer.provideMerge(Persistence.layerMemory),
            ),
          ),
        );
      }),
  );
});
