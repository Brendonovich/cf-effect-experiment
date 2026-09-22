import { describe, expect, it } from "@effect/vitest";
import { CustomTypes, Package, Project, SchemaId } from "@macrograph/core";
import { DataType, Engine, Module, Registration } from "@macrograph/module";
import { Array, DateTime, Effect, Option, Schema } from "effect";

import { Executor } from "../src/index.ts";

const recordId = DataType.DefinitionId.make("record/id");
const enumId = DataType.DefinitionId.make("result");
const recordType = DataType.Custom(recordId);
const definitions: DataType.Definitions = {
  [recordId]: {
    _tag: "Struct",
    id: recordId,
    name: "Record",
    fields: [
      { name: "name", type: DataType.String },
      { name: "dates", type: DataType.List(DataType.DateTime) },
      { name: "next", type: DataType.Option(recordType) },
    ],
  },
  [enumId]: {
    _tag: "Enum",
    id: enumId,
    name: "Result",
    variants: [
      { name: "Success", fields: [{ name: "item", type: recordType }] },
      { name: "Failure", fields: [{ name: "message", type: DataType.String }] },
      { name: "Empty", fields: [] },
    ],
  },
};
const catalog = CustomTypes.schemas(definitions);
const operation = (name: string) => {
  const schema = [...catalog.values()].find((schema) => schema.name === name);
  if (schema === undefined) throw new Error(`Missing operation ${name}`);
  return schema;
};
const run = (
  schema: Registration.RegisteredSchema,
  inputs: Readonly<Record<string, unknown>>,
  properties: Readonly<Record<string, unknown>> = {},
) =>
  Effect.gen(function* () {
    const outputs = new Map<string, unknown>();
    const selected = yield* schema.run({
      types: {
        resolve: (type) =>
          type._tag !== "Wildcard"
            ? type
            : type.id === "Enum"
              ? DataType.Custom(enumId)
              : recordType,
        definitions,
      },
      input: (port) => (Object.hasOwn(inputs, port.id) ? inputs[port.id] : port.defaultValue),
      output: (port, value) => {
        outputs.set(port.id, value);
      },
      properties,
      event: undefined,
      engine: undefined,
      execution: { projectId: "p", graphId: "g", eventNodeId: "event", traceId: "execution" },
      node: {
        nodeId: "node",
        kind: schema.type,
        executionPath: "event:event",
        traceId: "node",
        withSpan: (_name, effect) => effect,
      },
    });
    return { outputs, selected };
  });
const value = () => ({
  _type: recordId,
  name: "before",
  dates: [DateTime.makeUnsafe("2026-08-31T12:00:00Z")],
  next: Option.none(),
});

class Trigger extends Schema.TaggedClass<Trigger>()("GeneratedTrigger", {}) {}
class TestEngine extends Engine.make({ events: Array.empty<Trigger>() }) {}
const node = (
  id: string,
  packageId: string,
  schema: string,
  inputDefaults: Readonly<Record<string, unknown>> = {},
  properties: Readonly<Record<string, unknown>> = {},
) => ({
  id,
  name: id,
  schema: { package: packageId, schema },
  inputDefaults,
  properties,
  foldPins: false,
  position: { x: 0, y: 0 },
});
const wire = (
  id: string,
  outNodeId: string,
  outPortId: string,
  inNodeId: string,
  inIoId: string,
) => ({ id, outNodeId, outIo: { _tag: "Port" as const, id: outPortId }, inNodeId, inIoId });

describe("generated custom operations", () => {
  it.effect(
    "updates zero or many fields and distinguishes keeping, clearing and setting an optional field",
    () =>
      Effect.gen(function* () {
        const original = Object.freeze({ ...value(), next: Option.some(value()) });
        const update = operation("Update Struct");
        const unchanged = (yield* run(update, { value: original })).outputs.get("value");
        expect(unchanged).toEqual(original);
        expect(unchanged).not.toBe(original);
        const cleared = (yield* run(update, {
          value: original,
          'field:"name"': Option.some("after"),
          'field:"dates"': Option.some([]),
          'field:"next"': Option.some(Option.none()),
        })).outputs.get("value");
        expect(cleared).toEqual({ _type: recordId, name: "after", dates: [], next: Option.none() });
        const replacement = { ...value(), name: "nested" };
        const set = (yield* run(update, {
          value: original,
          'field:"next"': Option.some(Option.some(replacement)),
        })).outputs.get("value");
        expect(set).toEqual({ ...original, next: Option.some(replacement) });
        expect(original.next).toEqual(Option.some(value()));
        for (const invalid of ["raw string", Option.some(123), undefined]) {
          expect(
            yield* Effect.flip(run(update, { value: original, 'field:"name"': invalid })),
          ).toBeInstanceOf(CustomTypes.CodecError);
        }
      }),
  );

  it.effect("declares no target type properties and leaves unresolved IO as wildcards", () =>
    Effect.gen(function* () {
      for (const schema of CustomTypes.packageModel.schemas)
        expect(schema.properties.map((property) => property.id)).toEqual(
          schema.id === "ConstructEnum" ? ["variant"] : [],
        );
      expect(CustomTypes.selectionError("ConstructEnum", {}, definitions)).toBe(
        "Select an enum variant",
      );
      expect(
        CustomTypes.nodeIO(
          { package: CustomTypes.packageId, schema: SchemaId.make("UpdateStruct") },
          {},
          definitions,
        )?.dataInputs[0]?.type,
      ).toEqual(DataType.Wildcard("Struct"));
    }),
  );

  it.effect(
    "resolves one type's IO without enumerating unrelated definitions or constructing codecs",
    () =>
      Effect.gen(function* () {
        const registry = new Proxy(definitions, {
          ownKeys: () => {
            throw new Error("Node IO must not enumerate the registry");
          },
          get: (target, key, receiver) => {
            if (key === enumId) throw new Error("Node IO must not resolve unrelated type codecs");
            return Reflect.get(target, key, receiver);
          },
        });
        const ref = {
          package: CustomTypes.packageId,
          schema: SchemaId.make(operation("Make Struct").id),
        };
        expect(CustomTypes.nodeIO(ref, {}, registry)).toEqual(
          CustomTypes.nodeIO(ref, {}, definitions),
        );
        for (const id of [
          "{",
          "null",
          "[]",
          '["record/id","deleted"]',
          '["record/id","update","deleted"]',
          '["constructor","make"]',
        ])
          expect(
            CustomTypes.nodeIO({ ...ref, schema: SchemaId.make(id) }, {}, registry),
          ).toBeUndefined();
        const custom = DataType.Custom(enumId);
        const referenced: DataType.Definitions = {
          ...definitions,
          [recordId]: {
            _tag: "Struct",
            id: recordId,
            name: "Record",
            fields: [{ name: "result", type: custom }],
          },
        };
        const ioOnly = new Proxy(referenced, {
          get: (target, key, receiver) => {
            if (key === enumId) throw new Error("IO must not eagerly construct transitive codecs");
            return Reflect.get(target, key, receiver);
          },
        });
        expect(CustomTypes.nodeIO(ref, {}, ioOnly)).toEqual({
          dataInputs: [],
          dataOutputs: [{ id: "value", type: CustomTypes.makeWildcard }],
          executionInputs: [],
          executionOutputs: [],
        });
        const update = { ...ref, schema: SchemaId.make("UpdateStruct") };
        expect(CustomTypes.nodeIO(update, {}, ioOnly)?.dataInputs).toEqual([
          { id: "value", type: DataType.Wildcard("Struct") },
        ]);
      }),
  );
  it.effect("shares serializable catalog IO and stable nominal IDs across editor/runtime", () =>
    Effect.gen(function* () {
      const model = CustomTypes.packageModel;
      yield* Schema.encodeUnknownEffect(Package.Model)(model);
      expect(model.schemas).toHaveLength(7);
      expect(model.schemas).toHaveLength(CustomTypes.operations.length);
      for (const schema of model.schemas) {
        const properties = schema.id === "ConstructEnum" ? { variant: "Success" } : {};
        const io = CustomTypes.nodeIO(
          { package: CustomTypes.packageId, schema: schema.id },
          properties,
          definitions,
        );
        expect(io).toBeDefined();
        yield* Schema.encodeUnknownEffect(Package.SchemaModel)({ ...schema, ...io });
        expect(
          catalog
            .get(schema.id)
            ?.generateIO(properties)
            .dataInputs.map((port) => port.type),
        ).toEqual(io?.dataInputs.map((port) => port.type));
      }
      const renamed = {
        ...definitions,
        [recordId]: { ...definitions[recordId]!, name: "Renamed" },
      };
      expect([...CustomTypes.schemas(renamed).keys()]).toEqual([...catalog.keys()]);
      expect(
        CustomTypes.nodeIO(
          { package: CustomTypes.packageId, schema: SchemaId.make(operation("Make Struct").id) },
          {},
          {},
        )?.dataOutputs[0]?.type,
      ).toEqual(CustomTypes.makeWildcard);
    }),
  );

  it.effect(
    "makes, breaks, and updates optional fields without mutating or resetting other fields",
    () =>
      Effect.gen(function* () {
        const original = Object.freeze(value());
        const made = yield* run(operation("Make Struct"), {
          'field:"name"': original.name,
          'field:"dates"': original.dates,
          'field:"next"': original.next,
        });
        expect(made.outputs.get("value")).toEqual(original);
        const updated = yield* run(operation("Update Struct"), {
          value: original,
          'field:"name"': Option.some("after"),
        });
        expect(updated.outputs.get("value")).toEqual({ ...original, name: "after" });
        expect(original.name).toBe("before");
        const broken = yield* run(operation("Break Struct"), {
          value: updated.outputs.get("value"),
        });
        expect(broken.outputs.get('field:"name"')).toBe("after");
        expect(broken.outputs.get('field:"dates"')).toEqual(original.dates);
        const wrong = yield* Effect.flip(
          run(operation("Update Struct"), {
            value: { ...original, _type: "other" },
            'field:"name"': Option.some("after"),
          }),
        );
        expect(wrong).toBeInstanceOf(CustomTypes.CodecError);
        expect(
          yield* Effect.flip(run(operation("Make Struct"), { 'field:"name"': 1 })),
        ).toBeInstanceOf(CustomTypes.CodecError);
      }),
  );

  it.effect("constructs every tagged variant and emits only selected branch typed payloads", () =>
    Effect.gen(function* () {
      expect(operation("Match Enum").type).toBe("base");
      const model = yield* Schema.decodeUnknownEffect(Package.Model)(CustomTypes.packageModel);
      expect(model.schemas.find((schema) => schema.id === "MatchEnum")?.type).toBe("base");
      for (const [variant, inputs, payload] of [
        ["Success", { 'field:"item"': value() }, { item: value() }],
        ["Failure", { 'field:"message"': "failed" }, { message: "failed" }],
        ["Empty", {}, {}],
      ] as const) {
        const constructed = yield* run(operation("Construct Enum"), inputs, {
          variant,
        });
        const result = constructed.outputs.get("value");
        expect(result).toEqual({ _type: enumId, _tag: variant, ...payload });
        const matched = yield* run(operation("Match Enum"), { value: result });
        expect(matched.selected?.id).toBe(`variant:${JSON.stringify(variant)}`);
        expect([...matched.outputs.keys()]).toEqual([]);
        expect(
          matched.selected instanceof Registration.ScopeExecution ? matched.selected.payload : {},
        ).toEqual(
          Object.fromEntries(
            Object.entries(payload).map(([field, value]) => [
              `field:${JSON.stringify(field)}`,
              value,
            ]),
          ),
        );
      }
      expect(
        operation("Match Enum")
          .generateIO({})
          .executionOutputs.map((port) => port.id),
      ).not.toContain("exec");
      expect(
        yield* Effect.flip(
          run(operation("Match Enum"), { value: { _type: enumId, _tag: "Deleted" } }, {}),
        ),
      ).toBeInstanceOf(CustomTypes.CodecError);
    }),
  );

  it.effect(
    "roundtrips recursive custom JSON with DateTime/List/Option and rejects obsolete payloads",
    () =>
      Effect.gen(function* () {
        const original = { ...value(), next: Option.some(value()) };
        const encoded = yield* run(operation("Stringify JSON"), { value: original });
        const decoded = yield* run(operation("Parse JSON"), {
          json: encoded.outputs.get("json"),
        });
        expect(decoded.outputs.get("value")).toEqual(original);
        for (const json of [
          "{",
          JSON.stringify({ _type: "other" }),
          JSON.stringify({
            _type: recordId,
            name: "a",
            dates: [],
            next: { _tag: "None" },
            obsolete: true,
          }),
        ])
          expect(yield* Effect.flip(run(operation("Parse JSON"), { json }))).toBeInstanceOf(
            CustomTypes.CodecError,
          );
      }),
  );

  it.effect(
    "executes generated builtins without module registration and replays typed match payload",
    () =>
      Effect.gen(function* () {
        const captured: unknown[] = [];
        const module = Module.make({
          id: "generated-test",
          engine: TestEngine,
          effect: Effect.fnUntraced(function* (context) {
            yield* context.schema.register({
              id: "event",
              type: "event",
              event: () => Effect.succeed(true),
              io: () => ({}),
              run: () => Effect.void,
            });
            yield* context.schema.register({
              id: "sink",
              io: (io) => ({ value: io.data.in("value", recordType) }),
              run: ({ io }) =>
                Effect.sync(() => {
                  captured.push(io.value);
                }),
            });
            yield* context.schema.register({
              id: "enum-anchor",
              type: "pure",
              io: (io) => ({ value: io.data.in("value", DataType.Custom(enumId)) }),
              run: () => Effect.void,
            });
            yield* context.schema.register({
              id: "forbidden",
              io: () => ({}),
              run: () => Effect.die("Unselected branch must not execute"),
            });
          }),
        });
        const original = value();
        const stored = Schema.encodeUnknownSync(DataType.JsonValueSchema(recordType, definitions))(
          original,
        );
        const project = yield* Schema.decodeUnknownEffect(Project.Model)({
          ...Project.empty(),
          types: definitions,
          graphs: {
            g: {
              canvas: {
                id: "g",
                name: "Graph",
                nodes: {
                  event: node("event", module.id, "event"),
                  construct: node(
                    "construct",
                    CustomTypes.packageId,
                    operation("Construct Enum").id,
                    { 'field:"item"': stored },
                    { variant: "Success" },
                  ),
                  match: node("match", CustomTypes.packageId, operation("Match Enum").id, {}, {}),
                  update: node(
                    "update",
                    CustomTypes.packageId,
                    "UpdateStruct",
                    { 'field:"name"': { _tag: "Some", value: "updated" } },
                    {},
                  ),
                  sink: node("sink", module.id, "sink"),
                  forbidden: node("forbidden", module.id, "forbidden"),
                  enumAnchor: node("enumAnchor", module.id, "enum-anchor"),
                },
                scopeProjections: {
                  scope: { id: "scope", position: { x: 0, y: 0 } },
                  failureScope: { id: "failureScope", position: { x: 0, y: 0 } },
                },
                connections: [
                  wire("exec", "event", "exec", "match", "exec"),
                  wire("value", "construct", "value", "match", "value"),
                  wire("enum-anchor", "construct", "value", "enumAnchor", "value"),
                  wire("success", "match", 'variant:"Success"', "scope", "scope"),
                  wire("continue", "scope", "exec", "sink", "exec"),
                  wire("payload", "scope", 'field:"item"', "update", "value"),
                  wire("updated", "update", "value", "sink", "value"),
                  wire("failure", "match", 'variant:"Failure"', "failureScope", "scope"),
                  wire("failureContinue", "failureScope", "exec", "forbidden", "exec"),
                ],
              },
            },
          },
        });
        const checkpoints = new Map<string, Executor.SerializedNodeExecutionResult>();
        const driver = Executor.durableExecution((key, executor) => {
          const effect = executor.executeNode(key);
          const cached = checkpoints.get(key.nodeId);
          return cached === undefined
            ? effect.pipe(
                Effect.tap((result) =>
                  Effect.sync(() => {
                    checkpoints.set(key.nodeId, JSON.parse(JSON.stringify(result)));
                  }),
                ),
              )
            : Effect.succeed(cached);
        });
        const executor = yield* Executor.make(project, { executionEnvironment: driver });
        yield* executor.module(
          module,
          Engine.deployment(
            module,
            TestEngine.toLayer(() => Effect.die("Not hosted")),
          ),
        );
        yield* executor.handleEvent(module, new Trigger({}));
        const updated = { ...original, name: "updated" };
        expect(captured).toEqual([updated]);
        checkpoints.delete("sink");
        yield* executor.handleEvent(module, new Trigger({}));
        expect(captured).toEqual([updated, updated]);
        const matchCheckpoint = checkpoints.get("match")!;
        checkpoints.set("match", { ...matchCheckpoint, executionOutputId: 'variant:"Failure"' });
        expect((yield* Effect.flip(executor.handleEvent(module, new Trigger({}))))._tag).toBe(
          "InvalidOutputValue",
        );
        expect(captured).toHaveLength(2);
        checkpoints.set("match", matchCheckpoint);
        yield* executor.loadProject({ ...project, types: { [enumId]: definitions[enumId]! } });
        expect((yield* Effect.flip(executor.handleEvent(module, new Trigger({}))))._tag).toBe(
          "InvalidGraph",
        );
        expect(captured).toHaveLength(2);
      }),
  );

  it.effect("executes Make Struct from an output-inferred type without properties", () =>
    Effect.gen(function* () {
      const id = DataType.DefinitionId.make("made");
      const type = DataType.Custom(id);
      const types: DataType.Definitions = {
        [id]: {
          _tag: "Struct",
          id,
          name: "Made",
          fields: [{ name: "label", type: DataType.String }],
        },
      };
      const captured: unknown[] = [];
      const module = Module.make({
        id: "make-inference-test",
        engine: TestEngine,
        effect: Effect.fnUntraced(function* (context) {
          yield* context.schema.register({
            id: "event",
            type: "event",
            event: () => Effect.succeed(true),
            io: () => ({}),
            run: () => Effect.void,
          });
          yield* context.schema.register({
            id: "sink",
            io: (io) => ({ value: io.data.in("value", type) }),
            run: ({ io }) =>
              Effect.sync(() => {
                captured.push(io.value);
              }),
          });
        }),
      });
      const project = yield* Schema.decodeUnknownEffect(Project.Model)({
        ...Project.empty(),
        types,
        graphs: {
          g: {
            canvas: {
              id: "g",
              name: "Graph",
              nodes: {
                event: node("event", module.id, "event"),
                make: node(
                  "make",
                  CustomTypes.packageId,
                  "MakeStruct",
                  { 'field:"label"': "inferred" },
                  {},
                ),
                sink: node("sink", module.id, "sink"),
              },
              connections: [
                wire("exec", "event", "exec", "sink", "exec"),
                wire("value", "make", "value", "sink", "value"),
              ],
            },
          },
        },
      });
      const executor = yield* Executor.make(project);
      yield* executor.module(
        module,
        Engine.deployment(
          module,
          TestEngine.toLayer(() => Effect.die("Not hosted")),
        ),
      );
      yield* executor.handleEvent(module, new Trigger({}));
      expect(captured).toEqual([{ _type: id, label: "inferred" }]);
      expect(Project.canvases(project).g!.nodes.make!.properties).toEqual({});
    }),
  );
});
