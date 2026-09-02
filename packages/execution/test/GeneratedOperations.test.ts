import { describe, expect, it } from "@effect/vitest";
import { CustomTypes, Package, Project, SchemaId } from "@macrograph/core";
import { DataType, Engine, Plugin, Registration } from "@macrograph/plugin";
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
const run = (schema: Registration.RegisteredSchema, inputs: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const outputs = new Map<string, unknown>();
    const selected = yield* schema.run({
      input: (port) => inputs[port.id],
      output: (port, value) => {
        outputs.set(port.id, value);
      },
      properties: {},
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
) => ({
  id,
  name: id,
  schema: { package: packageId, schema },
  inputDefaults,
  properties: {},
  foldPins: false,
  position: { x: 0, y: 0 },
});
const wire = (
  id: string,
  outNodeId: string,
  outIoId: string,
  inNodeId: string,
  inIoId: string,
) => ({ id, outNodeId, outIoId, inNodeId, inIoId });

describe("generated custom operations", () => {
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
          schema: SchemaId.make(operation("Make Record").id),
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
        expect(CustomTypes.nodeIO(ref, {}, ioOnly)?.dataInputs[0]?.type).toEqual(custom);
      }),
  );
  it.effect("shares serializable catalog IO and stable nominal IDs across editor/runtime", () =>
    Effect.gen(function* () {
      const model = CustomTypes.packageModel(definitions);
      yield* Schema.encodeUnknownEffect(Package.Model)(model);
      expect(model.schemas).toHaveLength(13);
      for (const schema of model.schemas) {
        const io = CustomTypes.nodeIO(
          { package: CustomTypes.packageId, schema: schema.id },
          {},
          definitions,
        );
        expect(io).toEqual({
          dataInputs: schema.dataInputs,
          dataOutputs: schema.dataOutputs,
          executionInputs: schema.executionInputs,
          executionOutputs: schema.executionOutputs,
        });
        expect(
          catalog
            .get(schema.id)
            ?.generateIO({})
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
          { package: CustomTypes.packageId, schema: SchemaId.make(operation("Make Record").id) },
          {},
          {},
        ),
      ).toBeUndefined();
    }),
  );

  it.effect("makes, breaks, and updates one field without mutating or resetting other fields", () =>
    Effect.gen(function* () {
      const original = Object.freeze(value());
      const made = yield* run(operation("Make Record"), {
        'field:"name"': original.name,
        'field:"dates"': original.dates,
        'field:"next"': original.next,
      });
      expect(made.outputs.get("value")).toEqual(original);
      const updated = yield* run(operation("Update Record.name"), {
        value: original,
        'field:"name"': "after",
      });
      expect(updated.outputs.get("value")).toEqual({ ...original, name: "after" });
      expect(original.name).toBe("before");
      const broken = yield* run(operation("Break Record"), { value: updated.outputs.get("value") });
      expect(broken.outputs.get('field:"name"')).toBe("after");
      expect(broken.outputs.get('field:"dates"')).toEqual(original.dates);
      const wrong = yield* Effect.flip(
        run(operation("Update Record.name"), {
          value: { ...original, _type: "other" },
          'field:"name"': "after",
        }),
      );
      expect(wrong).toBeInstanceOf(CustomTypes.CodecError);
      expect(
        yield* Effect.flip(run(operation("Make Record"), { 'field:"name"': 1 })),
      ).toBeInstanceOf(CustomTypes.CodecError);
    }),
  );

  it.effect("constructs every tagged variant and emits only selected branch typed payloads", () =>
    Effect.gen(function* () {
      for (const [variant, inputs, payload] of [
        ["Success", { 'field:"item"': value() }, { item: value() }],
        ["Failure", { 'field:"message"': "failed" }, { message: "failed" }],
        ["Empty", {}, {}],
      ] as const) {
        const constructed = yield* run(operation(`Construct Result.${variant}`), inputs);
        const result = constructed.outputs.get("value");
        expect(result).toEqual({ _type: enumId, _tag: variant, ...payload });
        const matched = yield* run(operation("Match Result"), { value: result });
        expect(matched.selected?.id).toBe(`variant:${JSON.stringify(variant)}`);
        expect([...matched.outputs.keys()]).toEqual(
          Object.keys(payload).map(
            (field) => `variant:${JSON.stringify(variant)}/field:${JSON.stringify(field)}`,
          ),
        );
      }
      expect(operation("Match Result").executionOutputs.map((port) => port.id)).not.toContain(
        "exec",
      );
      expect(
        yield* Effect.flip(
          run(operation("Match Result"), { value: { _type: enumId, _tag: "Deleted" } }),
        ),
      ).toBeInstanceOf(CustomTypes.CodecError);
    }),
  );

  it.effect(
    "roundtrips recursive custom JSON with DateTime/List/Option and rejects obsolete payloads",
    () =>
      Effect.gen(function* () {
        const original = { ...value(), next: Option.some(value()) };
        const encoded = yield* run(operation("Stringify Record JSON"), { value: original });
        const decoded = yield* run(operation("Parse Record JSON"), {
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
          expect(yield* Effect.flip(run(operation("Parse Record JSON"), { json }))).toBeInstanceOf(
            CustomTypes.CodecError,
          );
      }),
  );

  it.effect(
    "executes generated builtins without plugin registration and replays typed match payload",
    () =>
      Effect.gen(function* () {
        const captured: unknown[] = [];
        const plugin = Plugin.make({
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
              id: "g",
              name: "Graph",
              nodes: {
                event: node("event", plugin.id, "event"),
                construct: node(
                  "construct",
                  CustomTypes.packageId,
                  operation("Construct Result.Success").id,
                  { 'field:"item"': stored },
                ),
                match: node("match", CustomTypes.packageId, operation("Match Result").id),
                sink: node("sink", plugin.id, "sink"),
                forbidden: node("forbidden", plugin.id, "forbidden"),
              },
              connections: [
                wire("exec", "event", "exec", "match", "exec"),
                wire("value", "construct", "value", "match", "value"),
                wire("success", "match", 'variant:"Success"', "sink", "exec"),
                wire("payload", "match", 'variant:"Success"/field:"item"', "sink", "value"),
                wire("failure", "match", 'variant:"Failure"', "forbidden", "exec"),
              ],
            },
          },
        });
        const checkpoints = new Map<string, Executor.NodeExecutionResult>();
        const driver: Executor.ExecutionDriver = {
          executeNode: (key, effect) => {
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
          },
        };
        const executor = yield* Executor.make(project, { executionDriver: driver });
        yield* executor.plugin(
          plugin,
          Engine.deployment(
            plugin,
            TestEngine.toLayer(() => Effect.die("Not hosted")),
          ),
        );
        yield* executor.handleEvent(plugin, new Trigger({}));
        expect(captured).toEqual([original]);
        checkpoints.delete("sink");
        yield* executor.handleEvent(plugin, new Trigger({}));
        expect(captured).toEqual([original, original]);
        const matchCheckpoint = checkpoints.get("match")!;
        checkpoints.set("match", { ...matchCheckpoint, executionOutputId: 'variant:"Failure"' });
        expect((yield* Effect.flip(executor.handleEvent(plugin, new Trigger({}))))._tag).toBe(
          "InvalidGraph",
        );
        expect(captured).toHaveLength(2);
        checkpoints.set("match", matchCheckpoint);
        yield* executor.loadProject({ ...project, types: { [enumId]: definitions[enumId]! } });
        expect((yield* Effect.flip(executor.handleEvent(plugin, new Trigger({}))))._tag).toBe(
          "InvalidGraph",
        );
        expect(captured).toHaveLength(2);
      }),
  );
});
