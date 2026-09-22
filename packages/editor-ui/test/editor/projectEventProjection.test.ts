import {
  Actor,
  Canvas,
  Connection,
  Function as GraphFunction,
  IoId,
  Node,
  PackageId,
  Project,
  ResourceConstant,
  SchemaId,
  OutputRef,
} from "@macrograph/core";
import { EditorEvent, ProjectEventProjection } from "@macrograph/editor";
import { Effect } from "effect";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";

import { createEditorStore } from "../../src/editor/store";

const node = (id: string): Node.Model => ({
  id: Node.NodeId.make(id),
  name: id,
  properties: {},
  inputDefaults: {},
  foldPins: false,
  schema: {
    package: PackageId.make("test"),
    schema: SchemaId.make("node"),
  },
  position: { x: 0, y: 0 },
});

const connection = (id: string, outNodeId: string, inNodeId: string): Connection.Model => ({
  id: Connection.ConnectionId.make(id),
  outNodeId,
  outIo: OutputRef.port("out"),
  inNodeId,
  inIoId: IoId.make("in"),
});

const emptyIO = { dataInputs: [], dataOutputs: [], executionInputs: [], executionOutputs: [] };

const initialProject = (): Project.Model => {
  const first = node("first");
  const second = node("second");
  return {
    ...Project.empty(),
    graphs: {
      main: {
        canvas: {
          ...Canvas.empty("main"),
          nodes: { [first.id]: first, [second.id]: second },
          connections: [connection("main-connection", first.id, second.id)],
        },
      },
    },
  };
};

const projectView = (project: Project.Model) => ({
  ...project,
  graphs: Object.fromEntries(
    Object.entries(Project.canvases(project)).map(([id, canvas]) => [
      id,
      project.functions[id] === undefined
        ? canvas
        : GraphFunction.projectCanvas(project.functions[id]),
    ]),
  ),
});

const memoryPersistence = (initial: Project.Model) => {
  let project = initial;
  const canvas = (graphId: string) => Project.canvases(project)[graphId]!;
  return {
    saveProject: (updated: Project.Model) => Effect.sync(() => void (project = updated)),
    loadProject: () => Effect.sync(() => project),
    loadGraph: (graphId: string) => Effect.sync(() => canvas(graphId)),
    loadNode: (graphId: string, nodeId: string) =>
      Effect.sync(() => canvas(graphId).nodes[nodeId]!),
    saveGraph: (graph: Canvas.Model) =>
      Effect.sync(() => {
        const updated = Project.replaceCanvas(project, graph);
        project =
          updated === project
            ? { ...project, graphs: { ...project.graphs, [graph.id]: { canvas: graph } } }
            : updated;
      }),
    deleteGraph: (graphId: string) =>
      Effect.sync(() => {
        const { [graphId]: _graph, ...graphs } = project.graphs;
        const { [graphId]: _function, ...functions } = project.functions;
        project = { ...project, graphs, functions };
      }),
    saveNode: (graphId: string, updatedNode: Node.Model) =>
      Effect.sync(() => {
        const graph = canvas(graphId);
        project = Project.replaceCanvas(project, {
          ...graph,
          nodes: { ...graph.nodes, [updatedNode.id]: updatedNode },
        });
      }),
    deleteNode: (graphId: string, nodeId: string) =>
      Effect.sync(() => {
        const graph = canvas(graphId);
        const { [nodeId]: _node, ...nodes } = graph.nodes;
        project = Project.replaceCanvas(project, { ...graph, nodes });
      }),
    saveConnection: (graphId: string, updatedConnection: Connection.Model) =>
      Effect.sync(() => {
        const graph = canvas(graphId);
        project = Project.replaceCanvas(project, {
          ...graph,
          connections: [...graph.connections, updatedConnection],
        });
      }),
    deleteConnection: (graphId: string, connectionId: string) =>
      Effect.sync(() => {
        const graph = canvas(graphId);
        project = Project.replaceCanvas(project, {
          ...graph,
          connections: graph.connections.filter((item) => item.id !== connectionId),
        });
      }),
  };
};

describe("project event projections", () => {
  it("produces equivalent Project.Model outcomes in persistence and the client store", async () => {
    const initial = initialProject();
    const scratch = Canvas.empty("scratch");
    const scratchNode = node("scratch-node");
    const fnCanvas = Canvas.empty("function");
    const fn: GraphFunction.Model = {
      canvas: fnCanvas,
      arguments: [],
      returns: [],
      inputPosition: { x: 10, y: 20 },
      outputPosition: { x: 30, y: 40 },
    };
    const field: GraphFunction.Field = {
      id: IoId.make("argument"),
      name: "Argument",
      type: { _tag: "String" },
    };
    const constant: ResourceConstant.Model = {
      id: ResourceConstant.Id.make("constant"),
      name: "Constant",
      resource: { package: "test", resource: "account" },
      value: "one",
    };
    const updatedConstant: ResourceConstant.Model = { ...constant, value: "two" };
    const events: ReadonlyArray<EditorEvent.Persistent> = [
      { _tag: "GraphCreated", actor: Actor.system, graph: scratch },
      {
        _tag: "GraphNameChanged",
        actor: Actor.system,
        graphId: scratch.id,
        name: "Scratch",
      },
      {
        _tag: "NodeCreated",
        actor: Actor.system,
        graphId: scratch.id,
        node: scratchNode,
        io: emptyIO,
      },
      {
        _tag: "NodeNameChanged",
        actor: Actor.system,
        graphId: scratch.id,
        nodeId: scratchNode.id,
        name: "Renamed",
      },
      {
        _tag: "NodePositionChanged",
        actor: Actor.system,
        graphId: scratch.id,
        nodeId: scratchNode.id,
        x: 12,
        y: 34,
      },
      {
        _tag: "NodeFoldPinsChanged",
        actor: Actor.system,
        graphId: scratch.id,
        nodeId: scratchNode.id,
        foldPins: true,
      },
      {
        _tag: "InputDefaultUpdated",
        actor: Actor.system,
        graphId: scratch.id,
        nodeId: scratchNode.id,
        input: "in",
        inputDefaults: { in: "default" },
      },
      {
        _tag: "ConnectionCreated",
        actor: Actor.system,
        graphId: scratch.id,
        connection: connection("scratch-connection", scratchNode.id, scratchNode.id),
      },
      {
        _tag: "ConnectionDeleted",
        actor: Actor.system,
        graphId: scratch.id,
        connectionId: "scratch-connection",
      },
      {
        _tag: "NodePropertyUpdated",
        actor: Actor.system,
        graphId: scratch.id,
        nodeId: scratchNode.id,
        property: "label",
        properties: { label: "updated" },
        inputDefaults: { in: "updated" },
        deletedConnectionIds: [],
        io: emptyIO,
      },
      {
        _tag: "NodeDeleted",
        actor: Actor.system,
        graphId: scratch.id,
        nodeId: scratchNode.id,
        deletedConnectionIds: [],
      },
      { _tag: "FunctionCreated", actor: Actor.system, graph: fnCanvas, fn },
      {
        _tag: "FunctionUpdated",
        actor: Actor.system,
        fn: { ...fn, arguments: [field] },
        deletedConnectionIds: [],
      },
      {
        _tag: "NodePositionChanged",
        actor: Actor.system,
        graphId: fnCanvas.id,
        nodeId: GraphFunction.InputBoundaryNodeId,
        x: 50,
        y: 60,
      },
      {
        _tag: "GraphNameChanged",
        actor: Actor.system,
        graphId: fnCanvas.id,
        name: "Renamed Function",
      },
      { _tag: "EngineStateChanged", actor: Actor.system, moduleId: "test", state: { on: true } },
      { _tag: "ResourceConstantCreated", actor: Actor.system, constant },
      {
        _tag: "ResourceConstantUpdated",
        actor: Actor.system,
        constant: updatedConstant,
        nodeIO: {},
        inputDefaults: { main: { first: { in: "constant" } } },
        deletedConnectionIds: { main: ["main-connection"] },
      },
      { _tag: "ResourceConstantDeleted", actor: Actor.system, constantId: constant.id },
      { _tag: "GraphDeleted", actor: Actor.system, graphId: scratch.id },
      { _tag: "GraphDeleted", actor: Actor.system, graphId: fnCanvas.id },
    ];

    const { editor, dispose } = createRoot((dispose) => ({ editor: createEditorStore(), dispose }));
    editor.setProject(projectView(initial), {});

    await Effect.runPromise(
      Effect.gen(function* () {
        const persistence = memoryPersistence(initial);
        for (const event of events) {
          expect(EditorEvent.isPersistent(event)).toBe(true);
          yield* ProjectEventProjection.apply(persistence, event);
          editor.applyEvent(event);

          const persisted = yield* persistence.loadProject();
          const view = editor.store.project;
          expect(view).not.toBeNull();
          if (view === null) continue;

          const functions = Object.fromEntries(
            Object.entries(view.functions).map(([id, storedFunction]) => {
              const canvas = view.graphs[id]!;
              const {
                [GraphFunction.InputBoundaryNodeId]: input,
                [GraphFunction.OutputBoundaryNodeId]: output,
                ...nodes
              } = canvas.nodes;
              return [
                id,
                {
                  ...storedFunction,
                  canvas: { ...canvas, nodes },
                  inputPosition: input?.position ?? storedFunction.inputPosition,
                  outputPosition: output?.position ?? storedFunction.outputPosition,
                },
              ];
            }),
          );
          const graphs = Object.fromEntries(
            Object.entries(view.graphs)
              .filter(([id]) => functions[id] === undefined)
              .map(([id, canvas]) => [id, { canvas }]),
          );
          expect({
            name: view.name,
            graphs,
            functions,
            engines: view.engines,
            constants: view.constants,
            queues: view.queues,
            types: view.types,
          }).toEqual(persisted);
        }
      }),
    );

    dispose();
  });

  it("classifies live resource and client-dirty events as ephemeral project events", async () => {
    const ephemeral: ReadonlyArray<EditorEvent.Ephemeral> = [
      {
        _tag: "ResourceValuesUpdated",
        actor: Actor.system,
        package: "test",
        resource: "account",
        values: [{ id: "one", display: "One" }],
      },
      { _tag: "ModuleClientStateDirty", actor: Actor.system, moduleId: "test" },
    ];

    expect(ephemeral.map((event) => [event._tag, EditorEvent.isEphemeral(event)])).toEqual([
      ["ResourceValuesUpdated", true],
      ["ModuleClientStateDirty", true],
    ]);

    const initial = initialProject();
    const { editor, dispose } = createRoot((dispose) => ({ editor: createEditorStore(), dispose }));
    editor.setProject(projectView(initial), {});
    await Effect.runPromise(
      Effect.gen(function* () {
        const persistence = memoryPersistence(initial);
        for (const event of ephemeral) {
          yield* ProjectEventProjection.apply(persistence, event);
          editor.applyEvent(event);
        }
        expect(yield* persistence.loadProject()).toEqual(initial);
      }),
    );
    expect(editor.store.project).toEqual(projectView(initial));
    dispose();
  });
});
