import {
  Actor,
  BuiltinAuthoring,
  ConnectionId,
  CustomTypes,
  Graph,
  IoId,
  NodeId,
  OutputRef,
  PackageId,
  Project,
  SchemaAuthoring,
  SchemaId,
  type Node,
  type NodeIO,
  type Package,
} from "@macrograph/core";
import { DataType as t } from "@macrograph/module/DataType";
import { Result } from "effect";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import { compatibleSchemaPorts } from "../../src/editor/graph/connectionAuthoring";
import { createEditorStore } from "../../src/editor/store";

const empty: NodeIO = {
  dataInputs: [],
  dataOutputs: [],
  executionInputs: [],
  executionOutputs: [],
};
const port = (id: string, type: t.Any) => ({ id: IoId.make(id), type });
const node = (
  id: string,
  schema: string,
  pkg = "authoring-test",
  properties: Node.Model["properties"] = {},
): Node.Model => ({
  id: NodeId.make(id),
  name: id,
  schema: { package: PackageId.make(pkg), schema: SchemaId.make(schema) },
  properties,
  inputDefaults: {},
  foldPins: false,
  position: { x: 0, y: 0 },
});
const wire = (out: string, output: string, input: string, inputId: string) => ({
  id: ConnectionId.make(`${out}-${output}-${input}-${inputId}`),
  outNodeId: out,
  outIo: OutputRef.port(output),
  inNodeId: input,
  inIoId: IoId.make(inputId),
});
const schema = (id: string, io: NodeIO = empty): Package.SchemaModel => ({
  ...io,
  id: SchemaId.make(id),
  name: id,
  type: "pure",
  properties: [],
});
const registry = (
  schemas: SchemaAuthoring.PackageDefinition["schemas"],
  models = Object.keys(schemas).map((id) => schema(id)),
) =>
  BuiltinAuthoring.registry.with({
    model: {
      id: PackageId.make("authoring-test"),
      name: "Authoring test",
      schemas: models,
      resources: [],
    },
    schemas,
  });

describe("schema-owned authoring", () => {
  it("supports dependent option sources on unrelated schemas without editor changes", () => {
    const source: SchemaAuthoring.PropertySource = {
      placeholder: "Select a field",
      unavailableLabel: "Select a type first",
      options: ({ definitions, properties }) => {
        const type =
          typeof properties.record === "string" ? definitions[properties.record] : undefined;
        return type?._tag === "Struct"
          ? type.fields.map((field) => ({ id: field.name, name: field.name }))
          : [];
      },
    };
    const custom = registry({ ChooseField: { properties: { field: source } } });
    const options = custom.get(node("n", "ChooseField").schema)!.properties!.field!;
    const definitions: t.Definitions = {
      item: {
        _tag: "Struct",
        id: t.DefinitionId.make("item"),
        name: "Item",
        fields: [{ name: "title", type: t.String }],
      },
    };
    expect(options.options({ properties: {}, definitions })).toEqual([]);
    expect(options.options({ properties: { record: "item" }, definitions })).toEqual([
      { id: "title", name: "title" },
    ]);
    expect(options.options({ properties: { record: "item" }, definitions: {} })).toEqual([]);
    expect(BuiltinAuthoring.registry.get(node("n", "ChooseField").schema)).toBeUndefined();
  });

  it("filters custom-type sources by kind, follows variant selection and reads renamed definitions", () => {
    const definitions: t.Definitions = {
      z: { _tag: "Struct", id: t.DefinitionId.make("z"), name: "Zulu", fields: [] },
      a: {
        _tag: "Enum",
        id: t.DefinitionId.make("a"),
        name: "Alpha",
        variants: [{ name: "Yes", fields: [] }],
      },
    };
    const source = (operation: string, property = "type") =>
      BuiltinAuthoring.registry.get({ package: "CustomTypes", schema: operation })!.properties![
        property
      ]!;
    const context = { definitions, properties: {} };
    expect(source("MakeStruct").options(context)).toEqual([{ id: "z", name: "Zulu" }]);
    expect(source("MatchEnum").options(context)).toEqual([{ id: "a", name: "Alpha" }]);
    expect(source("ParseJson").options(context)).toEqual([
      { id: "a", name: "Alpha" },
      { id: "z", name: "Zulu" },
    ]);
    expect(
      source("ConstructEnum", "variant").options({ definitions, properties: { type: "a" } }),
    ).toEqual([{ id: "Yes", name: "Yes" }]);
    expect(
      source("ConstructEnum", "variant").options({ definitions, properties: { type: "z" } }),
    ).toEqual([]);
    expect(
      source("MakeStruct").options({
        properties: {},
        definitions: { z: { ...definitions.z!, name: "Renamed" } },
      }),
    ).toEqual([{ id: "z", name: "Renamed" }]);
  });

  it("generates both input and output ports from an output-anchored type and clears stale pins", () => {
    const w = t.Wildcard("T");
    const base: NodeIO = { ...empty, dataOutputs: [port("value", w)] };
    const generate = vi.fn((ctx: SchemaAuthoring.IOContext) => {
      const type = ctx.resolve(w);
      return Result.succeed({
        ...base,
        dataInputs: type._tag === "Wildcard" ? [] : [port("item", type)],
      });
    });
    const resolver = new SchemaAuthoring.GraphResolver(
      registry({ Build: { generateIO: generate } }),
    );
    const graph: Graph.Model = {
      ...Graph.empty("g"),
      nodes: { build: node("build", "Build"), sink: node("sink", "Static") },
      connections: [wire("build", "value", "sink", "in")],
    };
    const declared = { build: base, sink: { ...empty, dataInputs: [port("in", t.String)] } };
    const first = resolver.resolve(graph, declared, {});
    expect(first.io.build?.dataInputs).toEqual([port("item", t.String)]);
    expect(first.diagnostics).toEqual({});
    generate.mockClear();
    expect(
      resolver.resolve(
        {
          ...graph,
          nodes: { ...graph.nodes, build: { ...graph.nodes.build!, position: { x: 50, y: 80 } } },
        },
        declared,
        {},
      ),
    ).toBe(first);
    expect(generate).not.toHaveBeenCalled();
    expect(
      resolver.resolve({ ...graph, connections: [] }, { ...declared, build: first.io.build! }, {})
        .io.build?.dataInputs,
    ).toEqual([]);
  });

  it("uses registered input constraints for candidates and inferred IO", () => {
    const w = t.Wildcard("T");
    const base = { ...empty, dataInputs: [port("in", w)] };
    const model = schema("OnlyInt", base);
    const authoring = registry(
      {
        OnlyInt: {
          acceptsInput: (_input, type) => type._tag === "Wildcard" || type._tag === "Int",
        },
      },
      [model],
    );
    const compatible = (type: t.Any) =>
      compatibleSchemaPorts(
        model,
        { direction: "output", port: { kind: "data", id: "out", type } },
        "authoring-test",
        {},
        authoring,
      );
    expect(compatible(t.String)).toEqual([]);
    expect(compatible(t.Int)).toHaveLength(1);
    expect(compatible(w)).toHaveLength(1);
    const graph = {
      ...Graph.empty("g"),
      nodes: { source: node("source", "Static"), target: node("target", "OnlyInt") },
      connections: [wire("source", "out", "target", "in")],
    };
    const resolved = new SchemaAuthoring.GraphResolver(authoring).resolve(
      graph,
      { source: { ...empty, dataOutputs: [port("out", t.String)] }, target: base },
      {},
    );
    expect(resolved.diagnostics.target).toEqual(["Input in does not accept the inferred type"]);
  });

  it("resolves scope-dependent IO independent of node order", () => {
    const authoring = registry({
      Relay: {
        generateIO: (ctx) =>
          Result.succeed({
            ...empty,
            executionInputs: [{ id: IoId.make("scope"), scope: null }],
            executionOutputs: [{ id: IoId.make("next"), scope: ctx.inputScope("scope") ?? [] }],
          }),
      },
      Expose: {
        generateIO: (ctx) =>
          Result.succeed({
            ...empty,
            executionInputs: [{ id: IoId.make("scope"), scope: null }],
            dataOutputs: ctx.inputScope("scope") ?? [],
          }),
      },
    });
    const graph = {
      ...Graph.empty("g"),
      nodes: {
        end: node("end", "Expose"),
        relay: node("relay", "Relay"),
        source: node("source", "Static"),
      },
      connections: [
        wire("relay", "next", "end", "scope"),
        wire("source", "scope", "relay", "scope"),
      ],
    };
    const declarations = {
      end: empty,
      relay: empty,
      source: {
        ...empty,
        executionOutputs: [{ id: IoId.make("scope"), scope: [port("field", t.String)] }],
      },
    };
    const resolver = new SchemaAuthoring.GraphResolver(authoring);
    const result = resolver.resolve(graph, declarations, {});
    expect(result.io.end?.dataOutputs).toEqual([port("field", t.String)]);
    expect(result.diagnostics).toEqual({});
    expect(
      resolver.resolve({ ...graph, connections: [graph.connections[0]!] }, result.io, {}).io.end
        ?.dataOutputs,
    ).toEqual([]);
  });

  it("keeps the catalog static across definition changes while regenerating node IO", () =>
    createRoot((dispose) => {
      const editor = createEditorStore();
      const n = node("make", "MakeStruct", "CustomTypes", { type: "item" });
      const project = {
        ...Project.empty(),
        graphs: { g: { ...Graph.empty("g"), nodes: { make: n } } },
      };
      editor.setProject(project, { g: { make: empty } });
      const before = editor.store.packages;
      editor.applyEvent({
        _tag: "TypeDefinitionsUpdated",
        actor: Actor.system,
        types: {
          item: {
            _tag: "Struct",
            id: t.DefinitionId.make("item"),
            name: "Item",
            fields: [{ name: "count", type: t.Int }],
          },
        },
        nodeIO: {},
        deletedConnectionIds: {},
      });
      expect(editor.store.packages).toEqual(before);
      expect(editor.store.nodeIO.g?.make?.dataInputs).toEqual([
        { id: 'field:"count"', name: "count", type: t.Int },
      ]);
      expect(editor.store.nodeDiagnostics.g?.make).toBeUndefined();
      expect(
        CustomTypes.packageModel.schemas.find((schema) => schema.id === "UpdateStruct")
          ?.properties[0]?.description,
      ).toContain("None keeps");
      dispose();
    }));

  it("reports bad struct anchors without looping or retaining inferred fields", () => {
    const graph = {
      ...Graph.empty("g"),
      nodes: {
        source: node("source", "Static"),
        target: node("target", "BreakStruct", "CustomTypes"),
      },
      connections: [wire("source", "out", "target", "value")],
    };
    const base = CustomTypes.nodeIO(graph.nodes.target.schema, {}, {})!;
    const result = new SchemaAuthoring.GraphResolver(BuiltinAuthoring.registry).resolve(
      graph,
      {
        source: { ...empty, dataOutputs: [port("out", t.String)] },
        target: { ...base, dataOutputs: [port("stale", t.String)] },
      },
      {},
    );
    expect(result.io.target?.dataOutputs).toEqual([]);
    expect(result.diagnostics.target).toEqual(["Break Struct requires a struct input"]);
  });

  it("bounds non-converging generators and reports them", () => {
    let toggle = false;
    const authoring = registry({
      Oscillate: {
        generateIO: () => {
          toggle = !toggle;
          return Result.succeed({ ...empty, dataOutputs: toggle ? [port("out", t.String)] : [] });
        },
      },
    });
    const graph = { ...Graph.empty("g"), nodes: { n: node("n", "Oscillate") } };
    expect(
      new SchemaAuthoring.GraphResolver(authoring).resolve(graph, { n: empty }, {}).diagnostics.n,
    ).toEqual(["Inferred IO did not stabilize"]);
  });

  it("does not discard inferred IO in components unrelated to a wildcard conflict", () => {
    const w = t.Wildcard("T");
    const dynamic = { ...empty, dataInputs: [port("in", w)] };
    const authoring = registry({
      Dynamic: {
        generateIO: (ctx) => {
          const type = ctx.resolve(w);
          return Result.succeed({
            ...dynamic,
            dataOutputs: type._tag === "Wildcard" ? [] : [port("out", type)],
          });
        },
      },
    });
    const nodes = Object.fromEntries(
      ["good", "bad", "string", "int", "anchor"].map((id) => [
        id,
        node(id, id === "good" || id === "bad" ? "Dynamic" : "Static"),
      ]),
    );
    const graph = {
      ...Graph.empty("g"),
      nodes,
      connections: [
        wire("anchor", "out", "good", "in"),
        wire("string", "out", "bad", "in"),
        wire("int", "out", "bad", "in"),
      ],
    };
    const result = new SchemaAuthoring.GraphResolver(authoring).resolve(
      graph,
      {
        good: dynamic,
        bad: dynamic,
        string: { ...empty, dataOutputs: [port("out", t.String)] },
        int: { ...empty, dataOutputs: [port("out", t.Int)] },
        anchor: { ...empty, dataOutputs: [port("out", t.String)] },
      },
      {},
    );
    expect(result.io.good?.dataOutputs).toEqual([port("out", t.String)]);
    expect(result.diagnostics.good).toBeUndefined();
    expect(result.io.bad?.dataOutputs).toEqual([]);
    expect(result.diagnostics.bad).toContain("Conflicting or recursive wildcard types");
  });

  it("does not allow a disconnected recursive struct chain to anchor itself via snapshot fields", () => {
    const id = t.DefinitionId.make("recursive");
    const definitions: t.Definitions = {
      recursive: {
        _tag: "Struct",
        id,
        name: "Recursive",
        fields: [{ name: "next", type: t.Custom(id) }],
      },
    };
    const a = node("a", "BreakStruct", "CustomTypes"),
      b = node("b", "BreakStruct", "CustomTypes");
    const graph = {
      ...Graph.empty("g"),
      nodes: { a, b },
      connections: [
        wire("a", 'field:"next"', "b", "value"),
        wire("b", 'field:"next"', "a", "value"),
      ],
    };
    const stale = {
      ...CustomTypes.nodeIO(a.schema, {}, definitions)!,
      dataOutputs: [{ id: IoId.make('field:"next"'), name: "next", type: t.Custom(id) }],
    };
    const resolved = new SchemaAuthoring.GraphResolver(BuiltinAuthoring.registry).resolve(
      graph,
      { a: stale, b: stale },
      definitions,
    );
    expect(resolved.io.a?.dataOutputs).toEqual([]);
    expect(resolved.io.b?.dataOutputs).toEqual([]);
    expect(resolved.io.a?.dataInputs[0]?.type).toEqual(CustomTypes.breakWildcard);
  });
});
