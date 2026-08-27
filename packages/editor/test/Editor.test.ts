import { NodeServices } from "@effect/platform-node";
import { assert, describe, expect, it } from "@effect/vitest";
import {
  Actor,
  ConnectionId,
  IoId,
  NodeId,
  Package,
  PackageId,
  RenderedProject,
  SchemaId,
} from "@macrograph/core";
import { Persistence } from "@macrograph/persistence";
import { DataType, Engine, Plugin, Resource } from "@macrograph/plugin";
import UtilitiesPlugin from "@macrograph/plugin-utilities";
import UtilitiesDeployment from "@macrograph/plugin-utilities/Deployment";
import { Effect, Layer, Option, PubSub, Result, Schema, Stream } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import { Editor, EditorEvents, Packages } from "../src/index";

const schemaRef = {
  package: PackageId.make("pkg"),
  schema: SchemaId.make("schema"),
};

const formatSchemaRef = {
  package: PackageId.make("format"),
  schema: SchemaId.make("format-string"),
};

const utilitiesFormatSchemaRef = {
  package: PackageId.make("util"),
  schema: SchemaId.make("FormatString"),
};

const makeFormatPlugin = (id: string) =>
  Plugin.make({
    id,
    effect: (context) =>
      context.schema.register({
        id: "format-string",
        name: "Format String",
        type: "pure",
        properties: {
          format: { name: "Format", type: DataType.String, defaultValue: "" },
          kind: { name: "Integer inputs", type: DataType.String, optional: true },
        },
        io: (io, properties) => {
          const format = typeof properties.format === "string" ? properties.format : "";
          const names = Array.from(
            format.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g),
            (match) => match[1],
          ).filter((name): name is string => name !== undefined);
          return {
            values: Array.from(new Set(names), (name) =>
              io.data.in(name, properties.kind === "int" ? DataType.Int : DataType.String, {
                name,
              }),
            ),
            result: io.data.out("result", DataType.String),
          };
        },
        run: () => Effect.void,
      }),
  });

const FormatPlugin = makeFormatPlugin("format");
const LateFormatPlugin = makeFormatPlugin("late-format");
const lateFormatSchemaRef = {
  package: PackageId.make("late-format"),
  schema: SchemaId.make("format-string"),
};

const suggestionSchemaRef = {
  package: PackageId.make("suggestions"),
  schema: SchemaId.make("search"),
};

const SuggestionPlugin = Plugin.make({
  id: "suggestions",
  effect: (context) =>
    context.schema.register({
      id: "search",
      name: "Search",
      description: "Suggests values using the current node state.",
      properties: {
        prefix: { name: "Prefix", type: DataType.String, defaultValue: "default" },
        enabled: { name: "Enabled", type: DataType.Bool, optional: true },
      },
      io: (io) => ({
        query: io.data.in("query", DataType.String, {
          suggestions: ({ properties, inputDefaults }) =>
            Effect.succeed([
              `${properties.prefix}:${typeof inputDefaults.query === "string" ? inputDefaults.query : "empty"}`,
            ]),
        }),
        broken: io.data.in("broken", DataType.String, {
          suggestions: () => Effect.die("resolver failed"),
        }),
        throws: io.data.in("throws", DataType.String, {
          suggestions: () => {
            throw new Error("resolver threw");
          },
        }),
      }),
      run: () => Effect.void,
    }),
});

class AccountResource extends Resource.make<AccountResource, string>()("account", {
  name: "Account",
  description: "An authenticated account.",
}) {}
class ResourceEngine extends Engine.make({
  resources: [AccountResource],
  rpcs: RpcGroup.make(
    Rpc.make("GetSuggestions", {
      payload: Schema.Struct({ account: Schema.String, query: Schema.String }),
      success: Schema.Array(Schema.String),
      error: Schema.String,
    }),
  ),
}) {}
const ResourcePlugin = Plugin.make({
  id: "resource-plugin",
  name: "Resources",
  engine: ResourceEngine,
  effect: (context) =>
    context.schema.register({
      id: "action",
      name: "Action",
      properties: { account: { name: "Account", resource: AccountResource } },
      io: (io, properties) => ({
        account: io.data.in(properties.account ?? "account", DataType.String, {
          suggestions: ({ properties, inputDefaults, engine }) => {
            const query = inputDefaults[properties.account];
            return engine.GetSuggestions({
              account: properties.account,
              query: typeof query === "string" ? query : "",
            });
          },
        }),
      }),
      run: () => Effect.void,
    }),
});
const ResourceDeployment = Engine.deployment(
  ResourcePlugin,
  ResourceEngine.toLayer(() => Effect.die("not hosted in editor unit test")),
);

const TestPackage = {
  id: PackageId.make("pkg"),
  name: "Test",
  resources: [],
  schemas: [
    {
      id: SchemaId.make("schema"),
      name: "Schema",
      type: "exec" as const,
      properties: [],
      dataInputs: [
        { id: IoId.make("text"), type: DataType.String },
        { id: IoId.make("count"), type: DataType.Int },
      ],
      dataOutputs: [
        { id: IoId.make("text"), type: DataType.String },
        { id: IoId.make("count"), type: DataType.Int },
      ],
      executionInputs: [{ id: IoId.make("exec") }],
      executionOutputs: [{ id: IoId.make("exec") }],
    },
  ],
};

const PackagesLayer = Layer.effect(
  Packages.Service,
  Effect.gen(function* () {
    const packages = yield* Packages.Service;
    yield* packages.loadPackage(TestPackage);
    return packages;
  }),
).pipe(Layer.provide(Packages.defaultLayer));

const SeedLayer = Layer.effectDiscard(
  Effect.flatMap(Persistence.Service, (db) =>
    db.saveProject({
      name: "test",
      graphs: {},
      engines: {},
      constants: {},
    }),
  ),
);

const TestLayer = Editor.defaultLayer.pipe(
  Layer.provide(SeedLayer),
  Layer.provideMerge(PackagesLayer),
  Layer.provideMerge(Persistence.layerMemory),
  Layer.provide(NodeServices.layer),
);

const makeEventPull = EditorEvents.Service.pipe(Effect.flatMap((events) => events.subscribe));

it.layer(TestLayer)((it) => {
  describe("Editor", () => {
    it.effect("createGraph publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const event = yield* editor.graph.create({ name: "Test Graph" });

        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual(event);
      }),
    );

    it.effect("uses New Graph as the default graph name", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const event = yield* editor.graph.create({});

        expect(event.graph.name).toBe("New Graph");
      }),
    );

    it.effect("retrieves hosted plugin client state", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        yield* editor.engine.hostClientState("plugin", Effect.succeed({ connected: true }));

        expect(yield* editor.engine.getClientState("plugin")).toEqual({ connected: true });
        const missing = yield* editor.engine.getClientState("missing").pipe(Effect.result);
        expect(Result.isFailure(missing)).toBe(true);
        if (Result.isFailure(missing)) expect(missing.failure._tag).toBe("EngineNotHosted");
      }),
    );

    it.effect("publishes plugin client state dirty notifications", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        yield* editor.engine.dirtyClientState("plugin");

        expect(yield* PubSub.take(events)).toEqual({
          _tag: "PluginClientStateDirty",
          actor: Actor.system,
          pluginId: "plugin",
        });
      }),
    );

    it.effect("setEngineState validates, persists, and publishes state", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;
        const TestEngine = Engine.make({
          storage: Schema.Struct({ accounts: Schema.Array(Schema.String) }),
          initialStorage: { accounts: [] },
        });
        const TestPlugin = Plugin.make({
          id: "engine-test",
          engine: TestEngine,
          effect: () => Effect.void,
        });
        if (false) {
          // @ts-expect-error Deployment layers must provide the declared engine service.
          Engine.deployment(TestPlugin, Layer.empty);
        }
        const deployment = Engine.deployment(
          TestPlugin,
          TestEngine.toLayer(() => Effect.die("Test engine is not hosted")),
        );
        // @ts-expect-error Engine plugins cannot be registered without a deployment.
        editor.plugin(TestPlugin);
        yield* editor.plugin(TestPlugin, deployment);

        const event = yield* editor.engine.setState("engine-test", {
          accounts: ["one", "two"],
        });

        expect(yield* PubSub.take(events)).toEqual(event);
        expect((yield* editor.project.get()).engines["engine-test"]).toEqual({
          accounts: ["one", "two"],
        });
      }),
    );

    it.effect("persists resource constants and rejects deletion while a node is bound", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const packages = yield* Packages.Service;
        yield* editor.plugin(ResourcePlugin, ResourceDeployment);
        const metadata = (yield* packages.getPackages()).find(
          (pkg) => pkg.id === "resource-plugin",
        );
        assert.deepStrictEqual(metadata?.resources, [
          {
            id: "account",
            name: "Account",
            description: "An authenticated account.",
          },
        ]);
        yield* editor.engine.hostResource("resource-plugin", "account", {
          values: Effect.succeed([
            { id: "account-1", display: "Streamer" },
            { id: "account-2", display: "Moderator" },
          ]),
          reload: Effect.void,
          changes: Stream.make([{ id: "account-1", display: "Streamer" }]),
        });

        const created = yield* editor.constant.create({
          package: "resource-plugin",
          resource: "account",
        });
        const renamed = yield* editor.constant.rename(created.constant.id, "Moderator");
        assert.strictEqual(renamed.constant.name, "Moderator");
        const selected = yield* editor.constant.select(created.constant.id, "account-1");
        assert.strictEqual(selected.constant.value, "account-1");

        const graph = yield* editor.graph.create({ name: "Resources" });
        const missingBinding = yield* editor.node
          .create({
            graphID: graph.graph.id,
            node: {
              schema: {
                package: PackageId.make("resource-plugin"),
                schema: SchemaId.make("action"),
              },
              properties: { account: "missing" },
            },
          })
          .pipe(Effect.result);
        assert(Result.isFailure(missingBinding));
        if (Result.isFailure(missingBinding))
          assert.strictEqual(missingBinding.failure._tag, "InvalidPropertyError");
        const node = yield* editor.node.create({
          graphID: graph.graph.id,
          node: {
            schema: {
              package: PackageId.make("resource-plugin"),
              schema: SchemaId.make("action"),
            },
            properties: { account: created.constant.id },
          },
        });
        assert.strictEqual(node.io.dataInputs[0]?.id, "account-1");
        assert.isTrue(node.io.dataInputs[0]?.suggestions);
        yield* editor.node.setInputDefault({
          graphID: graph.graph.id,
          nodeID: node.node.id,
          input: "account-1",
          value: "saved",
        });
        const getSuggestions = editor.node.getInputSuggestions({
          graphID: graph.graph.id,
          nodeID: node.node.id,
          input: "account-1",
        });
        expect(yield* Effect.flip(getSuggestions)).toMatchObject({
          _tag: "InvalidInputDefaultError",
          reason: "Suggestion resolver failed",
        });
        yield* editor.engine.hostRuntimeClient("resource-plugin", {
          GetSuggestions: (request: { account: string; query: string }) => {
            expect(request).toEqual({ account: "account-1", query: "saved" });
            return editor.node
              .setInputDefault({
                graphID: graph.graph.id,
                nodeID: node.node.id,
                input: "account-1",
                value: "saved",
              })
              .pipe(Effect.as(["live value"]));
          },
        });
        expect(yield* getSuggestions).toEqual(["live value"]);
        yield* editor.engine.hostRuntimeClient("resource-plugin", {
          GetSuggestions: () => Effect.fail("disconnected"),
        });
        expect(yield* Effect.flip(getSuggestions)).toMatchObject({
          _tag: "InvalidInputDefaultError",
          reason: "Suggestion resolver failed",
        });
        const changed = yield* editor.constant.select(created.constant.id, "account-2");
        assert.strictEqual(
          changed.nodeIO[graph.graph.id]?.[node.node.id]?.dataInputs[0]?.id,
          "account-2",
        );
        assert.deepStrictEqual(changed.inputDefaults[graph.graph.id]?.[node.node.id], {});
        assert.deepStrictEqual(
          (yield* editor.project.get()).graphs[graph.graph.id]?.nodes[node.node.id]?.inputDefaults,
          {},
        );
        const inUse = yield* editor.constant.delete(created.constant.id).pipe(Effect.result);
        assert(Result.isFailure(inUse));
        if (Result.isFailure(inUse)) {
          assert.strictEqual(inUse.failure._tag, "ResourceConstantInUseError");
          if (inUse.failure._tag === "ResourceConstantInUseError")
            assert.deepStrictEqual(inUse.failure.nodeIds, [node.node.id]);
        }

        yield* editor.node.delete({ graphID: graph.graph.id, nodeID: node.node.id });
        yield* editor.constant.delete(created.constant.id);
        assert.deepStrictEqual((yield* editor.project.get()).constants, {});
      }),
    );

    it.effect("deleteGraph publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const graphEvent = yield* editor.graph.create({ name: "Test Graph" });
        yield* PubSub.take(events);

        const event = yield* editor.graph.delete({ graphID: graphEvent.graph.id });
        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual(event);
      }),
    );

    it.effect("createNode publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const graphEvent = yield* editor.graph.create({ name: "Test Graph" });
        yield* PubSub.take(events);

        const event = yield* editor.node.create({
          graphID: graphEvent.graph.id,
          node: {
            name: "Test Node",
            position: { x: 100, y: 200 },
            schema: schemaRef,
          },
        });
        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual(event);
      }),
    );

    it.effect("calculates property-aware node IO and cleans stale connections", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;
        yield* editor.plugin(UtilitiesPlugin, UtilitiesDeployment);

        const graphEvent = yield* editor.graph.create({ name: "Dynamic IO" });
        yield* PubSub.take(events);
        const source = yield* editor.node.create({
          graphID: graphEvent.graph.id,
          node: { name: "Source", schema: schemaRef },
        });
        yield* PubSub.take(events);
        const format = yield* editor.node.create({
          graphID: graphEvent.graph.id,
          node: {
            name: "Format",
            schema: utilitiesFormatSchemaRef,
            properties: { format: "Hello {name}" },
            inputDefaults: { name: "World" },
          },
        });
        expect(format.io.dataInputs.map((input) => input.id)).toEqual(["name"]);
        expect(yield* PubSub.take(events)).toEqual(format);

        const snapshot = yield* editor.project.snapshot();
        expect(snapshot.nodeIO[graphEvent.graph.id]?.[format.node.id]).toEqual(format.io);

        const invalid = yield* Effect.flip(
          editor.connection.create({
            graphID: graphEvent.graph.id,
            connection: {
              outNodeId: source.node.id,
              outIoId: IoId.make("text"),
              inNodeId: format.node.id,
              inIoId: IoId.make("missing"),
            },
          }),
        );
        expect(invalid).toMatchObject({
          _tag: "InvalidConnectionError",
          reason: "Input does not identify one IO kind",
        });

        const connection = yield* editor.connection.create({
          graphID: graphEvent.graph.id,
          connection: {
            outNodeId: source.node.id,
            outIoId: IoId.make("text"),
            inNodeId: format.node.id,
            inIoId: IoId.make("name"),
          },
        });
        yield* PubSub.take(events);

        const property = yield* editor.node.setProperty({
          graphID: graphEvent.graph.id,
          nodeID: format.node.id,
          property: "format",
          value: "Goodbye {other}",
        });
        const propertyEvent = yield* PubSub.take(events);
        expect(propertyEvent).toEqual(property);
        expect(propertyEvent).toMatchObject({
          _tag: "NodePropertyUpdated",
          graphId: graphEvent.graph.id,
          nodeId: format.node.id,
        });
        if (propertyEvent._tag !== "NodePropertyUpdated") return;
        expect(propertyEvent.io.dataInputs.map((input) => input.id)).toEqual(["other"]);
        expect(propertyEvent.inputDefaults).toEqual({});
        expect(propertyEvent.deletedConnectionIds).toEqual([connection.connection.id]);

        const updated = yield* editor.project.snapshot();
        expect(
          updated.project.graphs[graphEvent.graph.id]?.nodes[format.node.id]?.properties,
        ).toEqual({ format: "Goodbye {other}" });
        expect(updated.project.graphs[graphEvent.graph.id]?.connections).toEqual([]);
        expect(
          updated.nodeIO[graphEvent.graph.id]?.[format.node.id]?.dataInputs.map(
            (input) => input.id,
          ),
        ).toEqual(["other"]);
      }),
    );

    it.effect("defaults and validates declared properties and resolves input suggestions", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;
        yield* editor.plugin(SuggestionPlugin);
        const packages = yield* Packages.Service;
        const metadata = yield* packages.getSchema(suggestionSchemaRef);
        expect(metadata.description).toBe("Suggests values using the current node state.");
        expect(metadata.properties.map((property) => property.id)).toEqual(["prefix", "enabled"]);

        const graph = yield* editor.graph.create({ name: "Suggestions" });
        yield* PubSub.take(events);
        const node = yield* editor.node.create({
          graphID: graph.graph.id,
          node: { schema: suggestionSchemaRef },
        });
        yield* PubSub.take(events);
        expect(node.node.name).toBe(metadata.name);
        expect(node.node.properties).toEqual({ prefix: "default" });

        const invalid = yield* Effect.flip(
          editor.node.setProperty({
            graphID: graph.graph.id,
            nodeID: node.node.id,
            property: "enabled",
            value: "yes",
          }),
        );
        expect(invalid._tag).toBe("InvalidPropertyError");
        const unknown = yield* Effect.flip(
          editor.node.setProperty({
            graphID: graph.graph.id,
            nodeID: node.node.id,
            property: "missing",
            value: true,
          }),
        );
        expect(unknown._tag).toBe("InvalidPropertyError");

        const setDefault = yield* editor.node.setInputDefault({
          graphID: graph.graph.id,
          nodeID: node.node.id,
          input: "query",
          value: "typed",
        });
        expect(yield* PubSub.take(events)).toEqual(setDefault);
        expect(
          yield* editor.node.getInputSuggestions({
            graphID: graph.graph.id,
            nodeID: node.node.id,
            input: "query",
          }),
        ).toEqual(["default:typed"]);
        for (const input of ["broken", "throws"]) {
          const resolverFailure = yield* Effect.flip(
            editor.node.getInputSuggestions({
              graphID: graph.graph.id,
              nodeID: node.node.id,
              input,
            }),
          );
          expect(resolverFailure).toMatchObject({
            _tag: "InvalidInputDefaultError",
            reason: "Suggestion resolver failed",
          });
        }
        const clearDefault = yield* editor.node.clearInputDefault({
          graphID: graph.graph.id,
          nodeID: node.node.id,
          input: "query",
        });
        expect(yield* PubSub.take(events)).toEqual(clearDefault);
        const persisted = (yield* editor.project.get()).graphs[graph.graph.id]?.nodes[node.node.id];
        expect(persisted?.inputDefaults).toEqual({});
      }),
    );

    it.effect("keeps undeclared schemas compatible with open property bags", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const graph = yield* editor.graph.create({ name: "Legacy properties" });
        const node = yield* editor.node.create({
          graphID: graph.graph.id,
          node: { schema: schemaRef },
        });
        yield* editor.node.setProperty({
          graphID: graph.graph.id,
          nodeID: node.node.id,
          property: "legacy",
          value: "still supported",
        });
        expect(
          (yield* editor.project.get()).graphs[graph.graph.id]?.nodes[node.node.id]?.properties,
        ).toEqual({ legacy: "still supported" });
      }),
    );

    it.effect("hydrates IO for persisted nodes created before package registration", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const nodeId = NodeId.make("persisted-format");
        const graph = yield* editor.graph.create({
          name: "Persisted",
          nodes: {
            [nodeId]: {
              id: nodeId,
              name: "Persisted Format",
              schema: lateFormatSchemaRef,
              properties: { format: "{first} {last}" },
              inputDefaults: {},
              foldPins: false,
              position: { x: 0, y: 0 },
            },
          },
          connections: [
            {
              id: ConnectionId.make("legacy"),
              outNodeId: nodeId,
              outIoId: IoId.make("result"),
              inNodeId: nodeId,
              inIoId: IoId.make("first"),
            },
          ],
        });
        const beforeRegistration = yield* editor.project.snapshot();
        expect(beforeRegistration.project.graphs[graph.graph.id]?.nodes[nodeId]).toBeDefined();
        expect(beforeRegistration.nodeIO[graph.graph.id]?.[nodeId]).toBeUndefined();
        yield* editor.plugin(LateFormatPlugin);

        const snapshot = yield* editor.project.snapshot();
        expect(
          snapshot.nodeIO[graph.graph.id]?.[nodeId]?.dataInputs.map((input) => input.id),
        ).toEqual(["first", "last"]);
        const rendered = yield* editor.project.rendered();
        const renderedNode = rendered.graphs[graph.graph.id]?.nodes[nodeId];
        expect(
          rendered.graphs[graph.graph.id]?.schemas[lateFormatSchemaRef.package]?.[
            lateFormatSchemaRef.schema
          ]?.name,
        ).toBe("Format String");
        expect(renderedNode?.io.dataInputs.map((input) => input.id)).toEqual(["first", "last"]);
      }),
    );

    it.effect("deletes connections when a retained data port changes type", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;
        yield* editor.plugin(FormatPlugin);
        const graph = yield* editor.graph.create({ name: "Dynamic Types" });
        yield* PubSub.take(events);
        const source = yield* editor.node.create({
          graphID: graph.graph.id,
          node: { name: "Source", schema: schemaRef },
        });
        yield* PubSub.take(events);
        const target = yield* editor.node.create({
          graphID: graph.graph.id,
          node: {
            name: "Target",
            schema: formatSchemaRef,
            properties: { format: "{value}" },
          },
        });
        yield* PubSub.take(events);
        const connection = yield* editor.connection.create({
          graphID: graph.graph.id,
          connection: {
            outNodeId: source.node.id,
            outIoId: IoId.make("text"),
            inNodeId: target.node.id,
            inIoId: IoId.make("value"),
          },
        });
        yield* PubSub.take(events);

        yield* editor.node.setProperty({
          graphID: graph.graph.id,
          nodeID: target.node.id,
          property: "kind",
          value: "int",
        });
        const propertyEvent = yield* PubSub.take(events);
        expect(propertyEvent._tag).toBe("NodePropertyUpdated");
        if (propertyEvent._tag !== "NodePropertyUpdated") return;
        expect(propertyEvent.deletedConnectionIds).toEqual([connection.connection.id]);
        expect(propertyEvent.io.dataInputs[0]?.type).toEqual(DataType.Int);
        expect((yield* editor.project.get()).graphs[graph.graph.id]?.connections).toEqual([]);
      }),
    );

    it.effect("recalculates snapshots after a package is replaced", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const packages = yield* Packages.Service;
        yield* editor.plugin(FormatPlugin);
        const graph = yield* editor.graph.create({ name: "Replacement" });
        const node = yield* editor.node.create({
          graphID: graph.graph.id,
          node: {
            name: "Format",
            schema: formatSchemaRef,
            properties: { format: "{dynamic}" },
          },
        });
        expect(node.io.dataInputs[0]?.id).toBe("dynamic");

        yield* packages.loadPackage({
          id: PackageId.make("format"),
          name: "Replacement",
          resources: [],
          schemas: [
            {
              id: SchemaId.make("format-string"),
              name: "Replacement",
              type: "pure",
              properties: [],
              dataInputs: [{ id: IoId.make("fixed"), type: DataType.Bool }],
              dataOutputs: [],
              executionInputs: [],
              executionOutputs: [],
            },
          ],
        });

        expect(
          (yield* editor.project.snapshot()).nodeIO[graph.graph.id]?.[node.node.id]?.dataInputs,
        ).toEqual([{ id: "fixed", type: DataType.Bool }]);
      }),
    );

    it.effect("deleteNode publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const graphEvent = yield* editor.graph.create({ name: "Test Graph" });
        yield* PubSub.take(events);

        const nodeEvent = yield* editor.node.create({
          graphID: graphEvent.graph.id,
          node: { name: "Node", schema: schemaRef },
        });
        yield* PubSub.take(events);

        const event = yield* editor.node.delete({
          graphID: graphEvent.graph.id,
          nodeID: nodeEvent.node.id,
        });
        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual(event);
      }),
    );

    it.effect("deleteNode removes every incident connection atomically", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;
        const graph = yield* editor.graph.create({ name: "Delete Connections" });
        yield* PubSub.take(events);
        const nodes = [];
        for (const name of ["Before", "Deleted", "After"]) {
          const created = yield* editor.node.create({
            graphID: graph.graph.id,
            node: { name, schema: schemaRef },
          });
          nodes.push(created.node);
          yield* PubSub.take(events);
        }
        const [before, deleted, after] = nodes;
        if (before === undefined || deleted === undefined || after === undefined) return;
        const incoming = yield* editor.connection.create({
          graphID: graph.graph.id,
          connection: {
            outNodeId: before.id,
            outIoId: IoId.make("text"),
            inNodeId: deleted.id,
            inIoId: IoId.make("text"),
          },
        });
        yield* PubSub.take(events);
        const outgoing = yield* editor.connection.create({
          graphID: graph.graph.id,
          connection: {
            outNodeId: deleted.id,
            outIoId: IoId.make("text"),
            inNodeId: after.id,
            inIoId: IoId.make("text"),
          },
        });
        yield* PubSub.take(events);

        const deletedEvent = yield* editor.node.delete({
          graphID: graph.graph.id,
          nodeID: deleted.id,
        });
        const expectedConnectionIds = [incoming.connection.id, outgoing.connection.id].sort();
        expect(deletedEvent.deletedConnectionIds).toEqual(expectedConnectionIds);
        expect(yield* PubSub.take(events)).toEqual(deletedEvent);
        expect((yield* editor.project.get()).graphs[graph.graph.id]?.connections).toEqual([]);
      }),
    );

    it.effect("createConnection publishes and persists an exec connection", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const graphEvent = yield* editor.graph.create({ name: "Test Graph" });
        yield* PubSub.take(events);
        const source = yield* editor.node.create({
          graphID: graphEvent.graph.id,
          node: { name: "Source", schema: schemaRef },
        });
        yield* PubSub.take(events);
        const target = yield* editor.node.create({
          graphID: graphEvent.graph.id,
          node: { name: "Target", schema: schemaRef },
        });
        yield* PubSub.take(events);

        const event = yield* editor.connection.create({
          graphID: graphEvent.graph.id,
          connection: {
            outNodeId: source.node.id,
            outIoId: IoId.make("exec"),
            inNodeId: target.node.id,
            inIoId: IoId.make("exec"),
          },
        });

        expect(yield* PubSub.take(events)).toEqual(event);
        const project = yield* editor.project.get();
        expect(project.graphs[graphEvent.graph.id]?.connections).toEqual([event.connection]);

        const duplicate = yield* Effect.result(
          editor.connection.create({
            graphID: graphEvent.graph.id,
            connection: {
              outNodeId: source.node.id,
              outIoId: IoId.make("exec"),
              inNodeId: target.node.id,
              inIoId: IoId.make("exec"),
            },
          }),
        );
        expect(Result.isFailure(duplicate)).toBe(true);
      }),
    );

    it.effect("validates connection kinds, data types, and input cardinality", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;
        const graphEvent = yield* editor.graph.create({ name: "Data Graph" });
        yield* PubSub.take(events);
        const nodes = [];
        for (const name of ["Source", "Other Source", "Target", "Other Target"]) {
          const event = yield* editor.node.create({
            graphID: graphEvent.graph.id,
            node: { name, schema: schemaRef },
          });
          yield* PubSub.take(events);
          nodes.push(event.node);
        }
        const [source, otherSource, target, otherTarget] = nodes;
        if (!source || !otherSource || !target || !otherTarget) return;

        yield* editor.connection.create({
          graphID: graphEvent.graph.id,
          connection: {
            outNodeId: source.id,
            outIoId: IoId.make("text"),
            inNodeId: target.id,
            inIoId: IoId.make("text"),
          },
        });
        yield* PubSub.take(events);
        yield* editor.connection.create({
          graphID: graphEvent.graph.id,
          connection: {
            outNodeId: source.id,
            outIoId: IoId.make("text"),
            inNodeId: otherTarget.id,
            inIoId: IoId.make("text"),
          },
        });
        yield* PubSub.take(events);

        yield* editor.connection.create({
          graphID: graphEvent.graph.id,
          connection: {
            outNodeId: source.id,
            outIoId: IoId.make("exec"),
            inNodeId: target.id,
            inIoId: IoId.make("exec"),
          },
        });
        yield* PubSub.take(events);
        yield* editor.connection.create({
          graphID: graphEvent.graph.id,
          connection: {
            outNodeId: source.id,
            outIoId: IoId.make("exec"),
            inNodeId: otherTarget.id,
            inIoId: IoId.make("exec"),
          },
        });
        yield* PubSub.take(events);

        const occupiedInput = yield* Effect.flip(
          editor.connection.create({
            graphID: graphEvent.graph.id,
            connection: {
              outNodeId: otherSource.id,
              outIoId: IoId.make("text"),
              inNodeId: target.id,
              inIoId: IoId.make("text"),
            },
          }),
        );
        expect(occupiedInput._tag).toBe("InvalidConnectionError");
        if (occupiedInput._tag !== "InvalidConnectionError") return;
        expect(occupiedInput.reason).toBe("Input already has a connection");

        const incompatible = yield* Effect.flip(
          editor.connection.create({
            graphID: graphEvent.graph.id,
            connection: {
              outNodeId: source.id,
              outIoId: IoId.make("count"),
              inNodeId: target.id,
              inIoId: IoId.make("text"),
            },
          }),
        );
        expect(incompatible._tag).toBe("InvalidConnectionError");
        if (incompatible._tag !== "InvalidConnectionError") return;
        expect(incompatible.reason).toBe("Data types are incompatible");

        const mixedKinds = yield* Effect.flip(
          editor.connection.create({
            graphID: graphEvent.graph.id,
            connection: {
              outNodeId: source.id,
              outIoId: IoId.make("exec"),
              inNodeId: target.id,
              inIoId: IoId.make("count"),
            },
          }),
        );
        expect(mixedKinds._tag).toBe("InvalidConnectionError");
        if (mixedKinds._tag !== "InvalidConnectionError") return;
        expect(mixedKinds.reason).toBe("Connection endpoints must have the same IO kind");
      }),
    );

    it.effect("setNodeName publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const graphEvent = yield* editor.graph.create({ name: "Test Graph" });
        yield* PubSub.take(events);

        const nodeEvent = yield* editor.node.create({
          graphID: graphEvent.graph.id,
          node: { name: "Old Name", schema: schemaRef },
        });
        yield* PubSub.take(events);

        yield* editor.node.update({
          graphID: graphEvent.graph.id,
          nodeID: nodeEvent.node.id,
          name: "New Name",
        });
        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual({
          _tag: "NodeNameChanged",
          actor: { type: "SYSTEM" },
          graphId: graphEvent.graph.id,
          nodeId: nodeEvent.node.id,
          name: "New Name",
        });
      }),
    );

    it.effect("setNodePosition publishes event", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;

        const graphEvent = yield* editor.graph.create({ name: "Test Graph" });
        yield* PubSub.take(events);

        const nodeEvent = yield* editor.node.create({
          graphID: graphEvent.graph.id,
          node: { name: "Node", schema: schemaRef },
        });
        yield* PubSub.take(events);

        yield* editor.node.update({
          graphID: graphEvent.graph.id,
          nodeID: nodeEvent.node.id,
          position: { x: 300, y: 400 },
        });
        const busEvent = yield* PubSub.take(events);
        expect(busEvent).toEqual({
          _tag: "NodePositionChanged",
          actor: { type: "SYSTEM" },
          graphId: graphEvent.graph.id,
          nodeId: nodeEvent.node.id,
          x: 300,
          y: 400,
        });

        yield* editor.node.update({
          graphID: graphEvent.graph.id,
          nodeID: nodeEvent.node.id,
          position: { x: 500, y: 600 },
          ephemeral: true,
        });
        yield* PubSub.take(events);
        expect(
          (yield* editor.project.get()).graphs[graphEvent.graph.id]?.nodes[nodeEvent.node.id]
            ?.position,
        ).toEqual({ x: 300, y: 400 });
      }),
    );

    it.effect("setNodeFoldPins publishes and persists the folded state", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const events = yield* makeEventPull;
        const graphEvent = yield* editor.graph.create({ name: "Folded Graph" });
        yield* PubSub.take(events);
        const nodeEvent = yield* editor.node.create({
          graphID: graphEvent.graph.id,
          node: { name: "Node", schema: schemaRef },
        });
        yield* PubSub.take(events);

        const event = yield* editor.node.setFoldPins({
          graphID: graphEvent.graph.id,
          nodeID: nodeEvent.node.id,
          foldPins: true,
        });
        expect(yield* PubSub.take(events)).toEqual(event);
        expect(
          (yield* editor.project.get()).graphs[graphEvent.graph.id]?.nodes[nodeEvent.node.id]
            ?.foldPins,
        ).toBe(true);
      }),
    );

    it.effect("updates a graph", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const graphEvent = yield* editor.graph.create({ name: "Old Name" });

        yield* editor.graph.update({ graphID: graphEvent.graph.id, name: "New Name" });

        const project = yield* editor.project.get();
        expect(project.graphs[graphEvent.graph.id]?.name).toBe("New Name");
      }),
    );

    it.effect("registers plugin schemas", () =>
      Effect.gen(function* () {
        const editor = yield* Editor.Service;
        const packages = yield* Packages.Service;
        const descriptors: ReadonlyArray<DataType.Any> = [
          DataType.String,
          DataType.Int,
          DataType.Float,
          DataType.Bool,
          DataType.DateTime,
          DataType.List(DataType.String),
          DataType.Option(DataType.Int),
          DataType.List(DataType.Option(DataType.List(DataType.String))),
        ];
        const encoded = yield* Schema.encodeUnknownEffect(Schema.Array(DataType.Descriptor))(
          descriptors,
        );
        expect(encoded).toEqual(descriptors);
        expect(
          yield* Schema.decodeUnknownEffect(Schema.Array(DataType.Descriptor))(encoded),
        ).toEqual(descriptors);
        const valueCodec = DataType.JsonValueSchema(DataType.List(DataType.Option(DataType.Int)));
        const encodedValue = yield* Schema.encodeUnknownEffect(valueCodec)([
          Option.some(1),
          Option.none(),
        ]);
        expect(encodedValue).toEqual([{ _tag: "Some", value: 1 }, { _tag: "None" }]);
        expect(yield* Schema.decodeUnknownEffect(valueCodec)(encodedValue)).toEqual([
          Option.some(1),
          Option.none(),
        ]);
        expect(
          yield* Schema.decodeUnknownEffect(Package.Model)({
            id: "legacy",
            name: "Legacy",
            schemas: [
              {
                id: "legacy",
                name: "Legacy",
                type: "exec",
                executionInputs: [],
                executionOutputs: [],
              },
            ],
          }),
        ).toMatchObject({
          schemas: [{ dataInputs: [], dataOutputs: [] }],
        });

        yield* editor.plugin(
          Plugin.make({
            id: "plugin",
            name: "Plugin",
            effect: (context) =>
              context.schema.register({
                id: "schema",
                name: "Schema",
                description: "A test schema.",
                io: (io) => ({
                  next: io.exec.out("next", { name: "Next" }),
                  names: io.data.in("names", DataType.List(DataType.String), { name: "Names" }),
                  optional: io.data.in("optional", DataType.Option(DataType.Int)),
                  result: io.data.out("result", DataType.Option(DataType.String)),
                }),
                run: () => Effect.void,
              }),
          }),
        );

        const schema = yield* packages.getSchema({
          package: PackageId.make("plugin"),
          schema: SchemaId.make("schema"),
        });
        expect(schema.name).toBe("Schema");
        expect(schema.description).toBe("A test schema.");
        expect(schema.type).toBe("exec");
        expect(schema.dataInputs).toEqual([
          { id: "names", name: "Names", type: { _tag: "List", item: { _tag: "String" } } },
          { id: "optional", type: { _tag: "Option", inner: { _tag: "Int" } } },
        ]);
        expect(schema.dataOutputs).toEqual([
          { id: "result", type: { _tag: "Option", inner: { _tag: "String" } } },
        ]);
        expect(schema.executionInputs).toEqual([{ id: "exec" }]);
        expect(schema.executionOutputs).toEqual([{ id: "exec" }, { id: "next", name: "Next" }]);

        const graph = yield* editor.graph.create({ name: "Composite defaults" });
        const node = yield* editor.node.create({
          graphID: graph.graph.id,
          node: {
            schema: { package: PackageId.make("plugin"), schema: SchemaId.make("schema") },
            inputDefaults: {
              names: ["one", "two"],
              optional: { _tag: "Some", value: 1 },
            },
          },
        });
        yield* editor.node.setInputDefault({
          graphID: graph.graph.id,
          nodeID: node.node.id,
          input: "optional",
          value: Option.none(),
        });
        expect(
          (yield* editor.project.get()).graphs[graph.graph.id]?.nodes[node.node.id]?.inputDefaults,
        ).toEqual({ names: ["one", "two"], optional: { _tag: "None" } });

        const rendered = yield* editor.project.rendered();
        const snapshot = yield* Schema.encodeUnknownEffect(RenderedProject.Model)(rendered).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(RenderedProject.Model)),
        );
        const renderedIo = snapshot.graphs[graph.graph.id]?.nodes[node.node.id]?.io;
        expect(renderedIo?.dataInputs.find((input) => input.id === "names")?.name).toBe("Names");
        expect(renderedIo?.executionOutputs.find((output) => output.id === "next")?.name).toBe(
          "Next",
        );

        const invalidComposite = yield* Effect.flip(
          editor.node.setInputDefault({
            graphID: graph.graph.id,
            nodeID: node.node.id,
            input: "names",
            value: ["valid", 1],
          }),
        );
        expect(invalidComposite._tag).toBe("InvalidInputDefaultError");
      }),
    );
  });
});
