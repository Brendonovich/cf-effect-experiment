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
import { Persistence, PersistenceError } from "@macrograph/persistence";
import { Engine } from "@macrograph/plugin";
import { DataType } from "@macrograph/plugin/DataType";
import { DateTime, Deferred, Effect, Fiber, Layer, Option, PubSub, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import { RpcTest } from "effect/unstable/rpc";

import ListPlugin from "../../plugins/list/src/Plugin.ts";
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
  ],
};
const generatedRef = (name: string) => {
  const schema = CustomTypes.packageModel(definitions).schemas.find(
    (schema) => schema.name === name,
  );
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
const make = generatedRef("Make Person");
const breakRef = generatedRef("Break Person");
const field = CustomTypes.nodeIO(make, {}, definitions)!.dataInputs[0]!.id;
const seed: Project.Model = {
  name: "Types",
  types: definitions,
  constants: {},
  engines: {},
  graphs: {
    first: {
      id: GraphId.make("first"),
      name: "First",
      nodes: {
        make: node("make", make, { [field]: "Ada" }),
        break: node("break", breakRef, { value: { _type: "person", name: "Ada" } }),
        string: node("string", { package: pkg.id, schema: SchemaId.make("string") }),
      },
      connections: [
        {
          id: ConnectionId.make("wire"),
          outNodeId: NodeId.make("break"),
          outIoId: field,
          inNodeId: NodeId.make("string"),
          inIoId: IoId.make("value"),
        },
      ],
    },
    second: {
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
};
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
  it.effect(
    "registered custom list IO encodes against current definitions and remains renderable after deletion",
    () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        yield* editor.plugin(ListPlugin);
        const persistence = yield* Persistence.Service;
        const create = node(
          "list-create",
          { package: PackageId.make("list"), schema: SchemaId.make("ListCreate") },
          { "value-0": [] },
          { type: JSON.stringify(DataType.List(DataType.Custom(personId))), number: 1 },
        );
        const push = node(
          "list-push",
          { package: PackageId.make("list"), schema: SchemaId.make("PushListValue") },
          { list: [{ _type: "person", name: "Ada" }], value: { _type: "person", name: "Grace" } },
          { type: JSON.stringify(DataType.Custom(personId)) },
        );
        yield* persistence.saveNode("second", create);
        yield* persistence.saveNode("second", push);
        const snapshot = yield* editor.project.snapshot();
        expect(snapshot.nodeIO.second![create.id]!.dataInputs[0]!.defaultValue).toEqual([]);
        expect(
          snapshot.nodeIO.second![push.id]!.dataInputs.find((input) => input.id === "list")!
            .defaultValue,
        ).toEqual([]);
        expect((yield* editor.project.rendered()).graphs.second!.nodes[push.id]!.io).toEqual(
          snapshot.nodeIO.second![push.id],
        );
        const impact = yield* editor.typeDefinition.preview({ _tag: "Delete", id: personId });
        for (const nodeId of [create.id, push.id])
          expect(impact.nodes.find((entry) => entry.nodeId === nodeId)!.reasons).toContain(
            "Generated inputs or outputs change",
          );
        const packages = yield* Packages.Service;
        const { person: _, ...proposed } = snapshot.project.types;
        const proposedPushIO = yield* packages.getNodeIO(push.schema, push.properties, proposed);
        expect(
          proposedPushIO.dataInputs.find((input) => input.id === "list")!.defaultValue,
        ).toBeUndefined();
        expect(yield* packages.getNodeIO(push.schema, push.properties)).toEqual(
          snapshot.nodeIO.second![push.id],
        );
        expect((yield* persistence.loadProject()).graphs).toEqual(snapshot.project.graphs);
        const event = yield* editor.typeDefinition.confirm({ token: impact.token });
        expect(event.nodeIO.second![push.id]).toEqual(proposedPushIO);
        const deleted = yield* editor.project.snapshot();
        expect(deleted.project.graphs.first!.connections).toEqual([]);
        expect(event.deletedConnectionIds).toEqual({ first: ["wire"] });
        expect(deleted.nodeIO).toEqual(event.nodeIO);
        expect(deleted.nodeIO.second![create.id]!.dataInputs[0]!.defaultValue).toBeUndefined();
        expect(
          deleted.nodeIO.second![push.id]!.dataInputs.find((input) => input.id === "list")!
            .defaultValue,
        ).toBeUndefined();
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
        expect((yield* editor.project.get()).graphs.first!.connections).toEqual([]);
        expect(event.nodeIO.first!.make!.dataInputs).toEqual([]);
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

  it.effect(
    "empty struct make and break nodes remain in impact despite their empty field port side",
    () =>
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
        for (const name of ["Make Empty", "Break Empty"]) {
          const schema = catalog.schemas.find((schema) => schema.name === name)!;
          created.push(
            (yield* editor.node.create({
              graphID: "second",
              node: { schema: { package: CustomTypes.packageId, schema: schema.id } },
            })).node.id,
          );
        }
        const before = yield* editor.project.get();
        const impact = yield* editor.typeDefinition.preview({ _tag: "Delete", id });
        expect(impact.nodes.map((node) => node.nodeId).sort()).toEqual(created.sort());
        const event = yield* editor.typeDefinition.confirm({ token: impact.token });
        expect((yield* editor.project.get()).graphs).toEqual(before.graphs);
        for (const nodeId of created)
          expect(
            TypeDefinition.nodeDiagnostics(
              before.graphs.second!.nodes[nodeId]!,
              event.nodeIO.second![nodeId]!,
              event.types,
            ).some((reason) => reason.includes("Missing generated schema")),
          ).toBe(true);
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
        expect(project.graphs.first!.connections).toEqual([]);
        expect(event.deletedConnectionIds).toEqual({ first: ["wire"] });
        expect(event.nodeIO.first!.make!.dataInputs).toEqual([]);
        expect((yield* editor.project.snapshot()).nodeIO).toEqual(event.nodeIO);
        expect(
          TypeDefinition.nodeDiagnostics(
            project.graphs.first!.nodes.break!,
            event.nodeIO.first!.break!,
            project.types,
          ).some((r) => r.includes("Invalid default")),
        ).toBe(true);
        yield* apply(yield* Persistence.Service, event);
        expect((yield* editor.project.get()).graphs.first!.connections).toEqual([]);
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect(
    "delete keeps dependent definitions invalid, supports orphan clear, and permits unrelated authoring/repair",
    () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const event = yield* mutate(editor, { _tag: "Delete", id: personId });
        expect(Object.keys(event.types)).toEqual(["group", "team"]);
        expect((yield* editor.project.get()).graphs.first!.connections).toEqual([]);
        expect((yield* editor.project.rendered()).graphs.first!.nodes.make!.io.dataOutputs).toEqual(
          [],
        );
        const diagnostics = TypeDefinition.nodeDiagnostics(
          seed.graphs.second!.nodes.sink!,
          event.nodeIO.second!.sink!,
          event.types,
        );
        expect(diagnostics).toContain("Missing type person");
        expect(
          TypeDefinition.nodeDiagnostics(
            seed.graphs.first!.nodes.make!,
            event.nodeIO.first!.make!,
            event.types,
          ).some((r) => r.includes("Missing generated schema")),
        ).toBe(true);
        yield* editor.node.clearInputDefault({ graphID: "first", nodeID: "make", input: field });
        expect((yield* editor.project.get()).graphs.first!.nodes.make!.inputDefaults).toEqual({});
        expect((yield* editor.project.get()).graphs.first!.connections).toEqual([]);
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

  it.effect(
    "field type replacement retains defaults and removes mismatched connections",
    () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const event = yield* mutate(editor, {
          _tag: "Upsert",
          definition: { ...person, fields: [{ name: "name", type: DataType.Int }] },
        });
        expect((yield* editor.project.get()).graphs.first!.connections).toEqual([]);
        expect(
          TypeDefinition.nodeDiagnostics(
            seed.graphs.first!.nodes.make!,
            event.nodeIO.first!.make!,
            event.types,
          ).some((r) => r.includes("Invalid default")),
        ).toBe(true);
        yield* editor.node.setInputDefault({
          graphID: "first",
          nodeID: "make",
          input: field,
          value: 42,
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
        expect(repaired.project.graphs.first!.connections).toEqual([]);
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
      expect((yield* editor.project.get()).graphs.first!.connections).toEqual([]);
      const event = yield* editor.node.setProperty({
        graphID: "second",
        nodeID: "property",
        property: "type",
        value: "String",
      });
      expect(event.deletedConnectionIds).toEqual([]);
      expect((yield* editor.project.get()).graphs.first!.nodes.make!.inputDefaults).toEqual(
        seed.graphs.first!.nodes.make!.inputDefaults,
      );
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
        const catalog = (yield* (yield* Packages.Service).getPackages()).find(
          (pkg) => pkg.id === CustomTypes.packageId,
        )!;
        const constructSchema = catalog.schemas.find((s) => s.name === "Construct Result.Found")!;
        const matchSchema = catalog.schemas.find((s) => s.name === "Match Result")!;
        const construct = yield* editor.node.create({
          graphID: "second",
          node: {
            schema: { package: CustomTypes.packageId, schema: constructSchema.id },
            inputDefaults: { [constructSchema.dataInputs[0]!.id]: "Ada" },
          },
        });
        const match = yield* editor.node.create({
          graphID: "second",
          node: {
            schema: { package: CustomTypes.packageId, schema: matchSchema.id },
            inputDefaults: { value: { _type: "result", _tag: "Found", name: "Ada" } },
          },
        });
        const wire = yield* editor.connection.create({
          graphID: "second",
          connection: {
            outNodeId: construct.node.id,
            outIoId: construct.io.dataOutputs[0]!.id,
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
              n.nodeId === construct.node.id &&
              n.reasons.some((r) => r.includes("Missing generated schema")),
          ),
        ).toBe(true);
        const event = yield* editor.typeDefinition.confirm({ token: impact.token });
        expect((yield* editor.project.get()).graphs.first).toEqual(before.graphs.first);
        expect((yield* editor.project.get()).graphs.second!.connections).toEqual([]);
        expect(event.deletedConnectionIds).toEqual({ second: [wire.connection.id] });
        expect(
          TypeDefinition.nodeDiagnostics(
            match.node,
            event.nodeIO.second![match.node.id]!,
            event.types,
          ).some((r) => r.includes("Invalid default")),
        ).toBe(true);
        yield* editor.node.clearInputDefault({
          graphID: "second",
          nodeID: construct.node.id,
          input: constructSchema.dataInputs[0]!.id,
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
            graphs: { ...p.graphs, second: { ...p.graphs.second!, name: "changed" } },
          }),
          (p) => ({
            ...p,
            graphs: { ...p.graphs, first: { ...p.graphs.first!, connections: [] } },
          }),
          (p) => ({
            ...p,
            graphs: {
              ...p.graphs,
              second: {
                ...p.graphs.second!,
                nodes: {
                  ...p.graphs.second!.nodes,
                  property: { ...p.graphs.second!.nodes.property!, properties: { type: "Int" } },
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
                nodes: {
                  ...p.graphs.first!.nodes,
                  make: { ...p.graphs.first!.nodes.make!, inputDefaults: { [field]: "Grace" } },
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

  it.effect(
    "tokens expire, cannot be guessed/replayed, and concurrent confirmation is serialized",
    () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        expect((yield* Effect.flip(editor.typeDefinition.confirm({ token: "guess" })))._tag).toBe(
          "StalePreviewError",
        );
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
        expect((yield* editor.project.get()).graphs.first!.connections).toEqual([]);
      }).pipe(Effect.provide(testLayer)),
  );

  it.effect("bounds cancelled previews and invalidates previews when package IO changes", () =>
    Effect.gen(function* () {
      const editor = yield* Editor.Service;
      const old = yield* editor.typeDefinition.preview(fresh);
      for (let i = 0; i < 128; i++) yield* editor.typeDefinition.preview(fresh);
      expect((yield* Effect.flip(editor.typeDefinition.confirm({ token: old.token })))._tag).toBe(
        "StalePreviewError",
      );
      const impact = yield* editor.typeDefinition.preview(fresh);
      yield* (yield* Packages.Service).loadPackage({ ...pkg, name: "Replaced" });
      expect(
        (yield* Effect.flip(editor.typeDefinition.confirm({ token: impact.token })))._tag,
      ).toBe("StalePreviewError");
      expect((yield* editor.project.get()).types).toEqual(definitions);
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
        expect((yield* client.GetProject({})).graphs.first!.connections).toEqual([]);
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
          expect(snapshot.project.graphs.first!.connections).toEqual([]);
          expect(snapshot.nodeIO.first!.make!.dataInputs).toEqual([]);
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
