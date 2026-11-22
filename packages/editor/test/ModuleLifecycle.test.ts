import { expect, it } from "@effect/vitest";
import {
  ConnectionId,
  Graph,
  IoId,
  NodeId,
  OutputRef,
  PackageId,
  Project,
  SchemaId,
  type Package,
} from "@macrograph/core";
import { Conversion, Engine, Module, ModuleId, t } from "@macrograph/module";
import { Persistence } from "@macrograph/persistence";
import { Effect, Exit, Layer, PubSub, Schema, Scope, Stream } from "effect";

import { Editor, EditorEvents, Packages } from "../src/index.ts";

const TestLayer = Editor.defaultLayer.pipe(
  Layer.provideMerge(Packages.defaultLayer),
  Layer.provideMerge(Persistence.layerMemory),
);

const moduleId = ModuleId.Id.make("local/test/lifecycle");
const packageId = PackageId.make(moduleId);
const Code = t.defineStruct("Code", "Code", { value: t.Int });
const qualifiedCode = `${moduleId}/Code`;

class LifecycleEngine extends Engine.make({
  storage: Schema.Struct({ count: Schema.Number }),
  initialStorage: { count: 0 },
}) {}

const LifecycleModule = Module.identify(
  moduleId,
  Module.make({
    name: "Lifecycle",
    engine: LifecycleEngine,
    types: { [Code.id]: Code },
    effect: Effect.fnUntraced(function* (context) {
      yield* context.conversion.register(
        Conversion.make({
          from: t.Struct(Code),
          to: t.String,
          convert: (code) => Effect.succeed(String(code.value)),
        }),
      );
      yield* context.schema.register({
        id: "source",
        type: "pure",
        io: (io) => ({ out: io.data.out("out", t.Struct(Code)) }),
        run: () => Effect.void,
      });
      yield* context.schema.register({
        id: "sink",
        io: (io) => ({ in: io.data.in("in", t.Struct(Code)) }),
        run: () => Effect.void,
      });
    }),
  }),
);
const LifecycleDeployment = Engine.identify(
  moduleId,
  Engine.deployment(
    LifecycleModule,
    LifecycleEngine.toLayer(() => Effect.die("Lifecycle engine is not hosted")),
  ),
);

const sourceId = NodeId.make("source");
const sinkId = NodeId.make("sink");
const savedProject: Project.Model = {
  ...Project.empty(),
  engines: { [moduleId]: { count: 3 } },
  graphs: {
    graph: {
      canvas: {
        ...Graph.empty("graph").canvas,
        nodes: {
          [sourceId]: {
            id: sourceId,
            name: "Source",
            schema: { package: packageId, schema: SchemaId.make("source") },
            properties: { kept: "value" },
            inputDefaults: {},
            foldPins: false,
            position: { x: 0, y: 0 },
          },
          [sinkId]: {
            id: sinkId,
            name: "Sink",
            schema: { package: packageId, schema: SchemaId.make("sink") },
            properties: {},
            inputDefaults: {},
            foldPins: false,
            position: { x: 100, y: 0 },
          },
        },
        connections: [
          {
            id: ConnectionId.make("wire"),
            outNodeId: sourceId,
            outIo: OutputRef.port("out"),
            inNodeId: sinkId,
            inIoId: IoId.make("in"),
          },
        ],
      },
    },
  },
};

const packageIds = (packages: ReadonlyArray<Package.Model>) => packages.map((pkg) => pkg.id).sort();

it.effect("removes a package registration and restores the one it shadowed", () =>
  Effect.gen(function* () {
    const packages = yield* Packages.Service;
    const before = packageIds(yield* packages.getPackages());
    const first: Package.Model = { id: packageId, name: "First", schemas: [], resources: [] };
    const second: Package.Model = { ...first, name: "Second" };
    const firstScope = yield* Scope.make();
    yield* packages.loadPackage(first).pipe(Scope.provide(firstScope));
    const secondScope = yield* Scope.make();
    yield* packages.loadPackage(second).pipe(Scope.provide(secondScope));
    const current = () =>
      packages.getPackages().pipe(Effect.map((all) => all.find((pkg) => pkg.id === packageId)));
    expect((yield* current())?.name).toBe("Second");
    yield* Scope.close(secondScope, Exit.void);
    expect((yield* current())?.name).toBe("First");
    yield* Scope.close(firstScope, Exit.void);
    expect(packageIds(yield* packages.getPackages())).toEqual(before);
  }).pipe(Effect.provide(Packages.defaultLayer)),
);

it.effect("undoes editor module and engine hosting registrations when their scope closes", () =>
  Effect.gen(function* () {
    yield* (yield* Persistence.Service).saveProject(Project.empty());
    const editor = yield* Editor.Service;
    const packages = yield* Packages.Service;
    const before = packageIds(yield* packages.getPackages());
    const scope = yield* Scope.make();
    yield* Effect.gen(function* () {
      yield* editor.module(LifecycleModule, LifecycleDeployment);
      yield* editor.engine.hostRuntimeClient(moduleId, { client: true });
      yield* editor.engine.hostClientState(moduleId, Effect.succeed({ connected: true }));
      yield* editor.engine.hostResource(moduleId, "account", {
        values: Effect.succeed([{ id: "a", display: "A" }]),
        reload: Effect.void,
        changes: Stream.never,
      });
    }).pipe(Scope.provide(scope));

    const loaded = (yield* packages.getPackages()).find((pkg) => pkg.id === packageId);
    expect(Object.keys(loaded?.types ?? {})).toEqual([qualifiedCode]);
    expect(loaded?.conversions).toEqual([{ from: t.Struct(qualifiedCode), to: t.String }]);
    expect(yield* editor.engine.getRuntimeClient(moduleId)).toEqual({ client: true });
    expect(yield* editor.engine.getClientCapabilities()).toEqual([moduleId]);
    expect(yield* editor.engine.getResourceValues(moduleId, "account")).toEqual([
      { id: "a", display: "A" },
    ]);
    expect(Exit.isSuccess(yield* Effect.exit(editor.engine.setState(moduleId, { count: 1 })))).toBe(
      true,
    );

    yield* Scope.close(scope, Exit.void);

    expect(packageIds(yield* packages.getPackages())).toEqual(before);
    expect((yield* Effect.flip(editor.engine.getRuntimeClient(moduleId)))._tag).toBe(
      "EngineNotHosted",
    );
    expect(yield* editor.engine.getClientCapabilities()).toEqual([]);
    expect((yield* Effect.flip(editor.engine.getResourceValues(moduleId, "account")))._tag).toBe(
      "InvalidResourceError",
    );
    expect((yield* Effect.flip(editor.engine.setState(moduleId, { count: 2 })))._tag).toBe(
      "EngineNotRegistered",
    );
    // The module can be registered again under the same id once it was removed.
    yield* editor.module(LifecycleModule, LifecycleDeployment);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect(
  "opens a project whose module is missing, keeps its data, and recovers when the module loads",
  () =>
    Effect.gen(function* () {
      const persistence = yield* Persistence.Service;
      yield* persistence.saveProject(savedProject);
      const editor = yield* Editor.Service;
      const events = yield* (yield* EditorEvents.Service).subscribe;

      // Placeholders: no IO, but every saved field, connection and engine storage is kept.
      const missing = yield* editor.project.snapshot();
      expect(missing.project.graphs.graph?.nodes[sourceId]?.properties).toEqual({ kept: "value" });
      expect(missing.project.graphs.graph?.connections.map((wire) => wire.id)).toEqual(["wire"]);
      expect(missing.project.engines[moduleId]).toEqual({ count: 3 });
      expect(missing.nodeIO.graph?.[sourceId]).toBeUndefined();
      const rendered = yield* editor.project.rendered();
      expect(rendered.graphs.graph?.nodes[sourceId]?.io.dataOutputs).toEqual([]);

      const scope = yield* Scope.make();
      yield* editor.module(LifecycleModule, LifecycleDeployment).pipe(Scope.provide(scope));
      const loaded = yield* PubSub.take(events);
      expect(loaded._tag).toBe("PackagesChanged");
      if (loaded._tag === "PackagesChanged") {
        expect(loaded.packages.some((pkg) => pkg.id === packageId)).toBe(true);
        expect(loaded.nodeIO.graph?.[sourceId]?.dataOutputs).toEqual([
          { id: "out", type: t.Struct(qualifiedCode) },
        ]);
        expect(loaded.nodeIO.graph?.[sinkId]?.dataInputs.map((port) => port.id)).toEqual(["in"]);
        expect(loaded.unavailableNodes).toEqual({});
      }
      const recovered = yield* editor.project.snapshot();
      expect(recovered.nodeIO.graph?.[sourceId]?.dataOutputs[0]?.type).toEqual(
        t.Struct(qualifiedCode),
      );

      yield* Scope.close(scope, Exit.void);
      const unloaded = yield* PubSub.take(events);
      expect(unloaded._tag).toBe("PackagesChanged");
      if (unloaded._tag === "PackagesChanged") {
        expect(unloaded.packages.some((pkg) => pkg.id === packageId)).toBe(false);
        expect([...(unloaded.unavailableNodes.graph ?? [])].sort()).toEqual([sinkId, sourceId]);
      }
      const persisted = yield* persistence.loadProject();
      expect(persisted.graphs.graph?.canvas).toEqual(savedProject.graphs.graph?.canvas);
      expect(persisted.engines).toEqual(savedProject.engines);
    }).pipe(Effect.provide(TestLayer)),
);
