import { expect, it } from "@effect/vitest";
import {
  ConnectionId,
  Graph,
  GraphId,
  IoId,
  Node,
  NodeId,
  OutputRef,
  PackageId,
  Project,
  SchemaId,
  type Canvas,
  type Scopes,
  type Connection,
} from "@macrograph/core";
import { Effect, Layer, Option } from "effect";
import { FastCheck as fc } from "effect/testing";

import { Persistence } from "../src/index.ts";

// Model-based property test for the incremental Persistence API.
//
// Random sequences of storage edits are applied both to a backend and to a small
// independent in-memory model. After every edit the backend must agree with the model.
//
// Storage-level semantics that the model deliberately mirrors:
// - Deleting a node does not delete its connections. Cascading is done by the editor,
//   which rewrites the graph with `saveGraph`, so dangling connections are valid here.
// - Connections may reference nodes that do not exist.
// - Saving a node or connection with an existing id replaces it in place.
//
// The generator stays within the domain the editor actually produces:
// - Node and connection edits only target graphs that exist. Behaviour for missing
//   graphs differs between backends and is not exercised.
// - Node ids are unique across graphs, because SQLite keys nodes by id globally.
// - Scope projection ids are unique across graphs too, and only `saveGraph` writes them,
//   as in the editor.

const graphIds = ["g1", "g2", "g3"] as const;
const nodeSlots = ["a", "b", "c"] as const;
const ports = ["exec", "value"] as const;
const projectionSlots = ["p", "q"] as const;

type GraphKey = (typeof graphIds)[number];
type NodeSlot = (typeof nodeSlots)[number];
type ProjectionSlot = (typeof projectionSlots)[number];

interface NodeSpec {
  readonly slot: NodeSlot;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly foldPins: boolean;
  readonly label: string;
  readonly split: ReadonlyArray<string> | null;
}

interface ProjectionSpec {
  readonly slot: ProjectionSlot;
  readonly x: number;
  readonly y: number;
}

interface ConnectionSpec {
  readonly out: NodeSlot;
  readonly outPort: string;
  readonly in: NodeSlot;
  readonly inPort: string;
}

type Command =
  | { readonly _tag: "SaveProject"; readonly name: string }
  | {
      readonly _tag: "SaveGraph";
      readonly graphId: GraphKey;
      readonly name: string;
      readonly nodes: ReadonlyArray<NodeSpec>;
      readonly projections: ReadonlyArray<ProjectionSpec>;
      readonly connections: ReadonlyArray<ConnectionSpec>;
    }
  | { readonly _tag: "DeleteGraph"; readonly graphId: GraphKey }
  | { readonly _tag: "SaveNode"; readonly graphId: GraphKey; readonly node: NodeSpec }
  | { readonly _tag: "DeleteNode"; readonly graphId: GraphKey; readonly slot: NodeSlot }
  | {
      readonly _tag: "SaveConnection";
      readonly graphId: GraphKey;
      readonly connection: ConnectionSpec;
      /** Reuse an existing connection id in the graph instead of minting a fresh one. */
      readonly reuse: number | null;
    }
  | {
      readonly _tag: "DeleteConnection";
      readonly graphId: GraphKey;
      readonly pick: number | null;
    };

const graphIdArb = fc.constantFrom(...graphIds);
const slotArb = fc.constantFrom(...nodeSlots);
const portArb = fc.constantFrom(...ports);
const nameArb = fc.string({ maxLength: 8 });

const nodeSpecArb: fc.Arbitrary<NodeSpec> = fc.record({
  slot: slotArb,
  name: nameArb,
  x: fc.integer({ min: -1000, max: 1000 }),
  y: fc.integer({ min: -1000, max: 1000 }),
  foldPins: fc.boolean(),
  label: nameArb,
  split: fc.option(fc.subarray([...ports]), { nil: null }),
});

const projectionSpecArb: fc.Arbitrary<ProjectionSpec> = fc.record({
  slot: fc.constantFrom(...projectionSlots),
  x: fc.integer({ min: -1000, max: 1000 }),
  y: fc.integer({ min: -1000, max: 1000 }),
});

const connectionSpecArb: fc.Arbitrary<ConnectionSpec> = fc.record({
  out: slotArb,
  outPort: portArb,
  in: slotArb,
  inPort: portArb,
});

const commandArb: fc.Arbitrary<Command> = fc.oneof(
  { arbitrary: fc.record({ _tag: fc.constant("SaveProject"), name: nameArb }), weight: 1 },
  {
    arbitrary: fc.record({
      _tag: fc.constant("SaveGraph"),
      graphId: graphIdArb,
      name: nameArb,
      nodes: fc.array(nodeSpecArb, { maxLength: 3 }),
      projections: fc.array(projectionSpecArb, { maxLength: 2 }),
      connections: fc.array(connectionSpecArb, { maxLength: 3 }),
    }),
    weight: 3,
  },
  { arbitrary: fc.record({ _tag: fc.constant("DeleteGraph"), graphId: graphIdArb }), weight: 1 },
  {
    arbitrary: fc.record({ _tag: fc.constant("SaveNode"), graphId: graphIdArb, node: nodeSpecArb }),
    weight: 4,
  },
  {
    arbitrary: fc.record({ _tag: fc.constant("DeleteNode"), graphId: graphIdArb, slot: slotArb }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      _tag: fc.constant("SaveConnection"),
      graphId: graphIdArb,
      connection: connectionSpecArb,
      reuse: fc.option(fc.nat(), { nil: null, freq: 2 }),
    }),
    weight: 4,
  },
  {
    arbitrary: fc.record({
      _tag: fc.constant("DeleteConnection"),
      graphId: graphIdArb,
      pick: fc.option(fc.nat(), { nil: null }),
    }),
    weight: 2,
  },
);

const nodeId = (graphId: string, slot: NodeSlot) => NodeId.make(`${graphId}.${slot}`);

const makeNode = (graphId: string, spec: NodeSpec): Node.Model => ({
  id: nodeId(graphId, spec.slot),
  name: spec.name,
  properties: { label: spec.label },
  inputDefaults: {},
  foldPins: spec.foldPins,
  ...(spec.split === null ? {} : { splitScopeOutputs: spec.split.map((id) => IoId.make(id)) }),
  schema: { package: PackageId.make("model-package"), schema: SchemaId.make("model-schema") },
  position: { x: spec.x, y: spec.y },
});

const makeConnection = (graphId: string, id: string, spec: ConnectionSpec): Connection.Model => ({
  id: ConnectionId.make(id),
  outNodeId: nodeId(graphId, spec.out),
  outIo: OutputRef.port(spec.outPort),
  inNodeId: nodeId(graphId, spec.in),
  inIoId: IoId.make(spec.inPort),
});

const makeProjection = (graphId: string, spec: ProjectionSpec): Scopes.Projection => ({
  id: NodeId.make(`${graphId}.${spec.slot}`),
  position: { x: spec.x, y: spec.y },
});

interface ModelGraph {
  readonly name: string;
  readonly nodes: ReadonlyMap<string, Node.Model>;
  readonly scopeProjections: ReadonlyMap<string, Scopes.Projection>;
  readonly connections: ReadonlyArray<Connection.Model>;
}

interface Model {
  readonly name: string;
  readonly graphs: ReadonlyMap<string, ModelGraph>;
}

const toCanvas = (graphId: string, graph: ModelGraph): Canvas.Model => ({
  id: GraphId.make(graphId),
  name: graph.name,
  nodes: Object.fromEntries(graph.nodes),
  // Absent and empty are equivalent; backends return the key only when there are projections.
  ...(graph.scopeProjections.size === 0
    ? {}
    : { scopeProjections: Object.fromEntries(graph.scopeProjections) }),
  connections: graph.connections,
});

const toProject = (model: Model): Project.Model => ({
  name: model.name,
  graphs: Object.fromEntries(
    [...model.graphs].map(([id, graph]) => [id, { canvas: toCanvas(id, graph) }]),
  ),
  functions: {},
  engines: {},
  constants: {},
  types: {},
  queues: {},
});

const withGraph = (model: Model, graphId: string, graph: ModelGraph): Model => ({
  ...model,
  graphs: new Map(model.graphs).set(graphId, graph),
});

// A resolved step: the concrete backend call, the equivalent production mutation, and
// the next model state. `undefined` means the command is outside the supported domain
// for the current model state and is skipped.
interface Step {
  readonly run: (persistence: Persistence.Interface) => Effect.Effect<void, unknown>;
  readonly mutation: Persistence.ProjectMutation;
  readonly next: Model;
}

const resolve = (model: Model, command: Command, index: number): Step | undefined => {
  switch (command._tag) {
    case "SaveProject": {
      const next = { ...model, name: command.name };
      const project = toProject(next);
      return {
        run: (persistence) => persistence.saveProject(project),
        mutation: { _tag: "SaveProject", project },
        next,
      };
    }
    case "SaveGraph": {
      const graph: ModelGraph = {
        name: command.name,
        nodes: new Map(
          command.nodes.map((spec) => [
            nodeId(command.graphId, spec.slot),
            makeNode(command.graphId, spec),
          ]),
        ),
        scopeProjections: new Map(
          command.projections.map((spec) => {
            const projection = makeProjection(command.graphId, spec);
            return [projection.id, projection];
          }),
        ),
        connections: command.connections.map((spec, k) =>
          makeConnection(command.graphId, `c${index}.${k}`, spec),
        ),
      };
      const canvas = toCanvas(command.graphId, graph);
      return {
        run: (persistence) => persistence.saveGraph(canvas),
        mutation: { _tag: "SaveGraph", graph: canvas },
        next: withGraph(model, command.graphId, graph),
      };
    }
    case "DeleteGraph": {
      const graphs = new Map(model.graphs);
      graphs.delete(command.graphId);
      return {
        run: (persistence) => persistence.deleteGraph(command.graphId),
        mutation: { _tag: "DeleteGraph", graphId: command.graphId },
        next: { ...model, graphs },
      };
    }
    case "SaveNode": {
      const graph = model.graphs.get(command.graphId);
      if (graph === undefined) return undefined;
      const node = makeNode(command.graphId, command.node);
      return {
        run: (persistence) => persistence.saveNode(command.graphId, node),
        mutation: { _tag: "SaveNode", graphId: command.graphId, node },
        next: withGraph(model, command.graphId, {
          ...graph,
          nodes: new Map(graph.nodes).set(node.id, node),
        }),
      };
    }
    case "DeleteNode": {
      const graph = model.graphs.get(command.graphId);
      if (graph === undefined) return undefined;
      const id = nodeId(command.graphId, command.slot);
      const nodes = new Map(graph.nodes);
      nodes.delete(id);
      return {
        run: (persistence) => persistence.deleteNode(command.graphId, id),
        mutation: { _tag: "DeleteNode", graphId: command.graphId, nodeId: id },
        next: withGraph(model, command.graphId, { ...graph, nodes }),
      };
    }
    case "SaveConnection": {
      const graph = model.graphs.get(command.graphId);
      if (graph === undefined) return undefined;
      const reused =
        command.reuse === null || graph.connections.length === 0
          ? undefined
          : graph.connections[command.reuse % graph.connections.length]!.id;
      const connection = makeConnection(command.graphId, reused ?? `c${index}`, command.connection);
      return {
        run: (persistence) => persistence.saveConnection(command.graphId, connection),
        mutation: { _tag: "SaveConnection", graphId: command.graphId, connection },
        next: withGraph(model, command.graphId, {
          ...graph,
          connections:
            reused === undefined
              ? [...graph.connections, connection]
              : graph.connections.map((existing) =>
                  existing.id === reused ? connection : existing,
                ),
        }),
      };
    }
    case "DeleteConnection": {
      const graph = model.graphs.get(command.graphId);
      if (graph === undefined) return undefined;
      const target =
        command.pick === null || graph.connections.length === 0
          ? "missing-connection"
          : graph.connections[command.pick % graph.connections.length]!.id;
      return {
        run: (persistence) => persistence.deleteConnection(command.graphId, target),
        mutation: { _tag: "DeleteConnection", graphId: command.graphId, connectionId: target },
        next: withGraph(model, command.graphId, {
          ...graph,
          connections: graph.connections.filter((connection) => connection.id !== target),
        }),
      };
    }
  }
};

const checkAgreement = Effect.fnUntraced(function* (
  persistence: Persistence.Interface,
  model: Model,
) {
  const expected = toProject(model);
  const project = yield* persistence.loadProject();
  expect(project).toEqual(expected);

  for (const graph of Object.values(project.graphs)) {
    const ids = graph.canvas.connections.map((connection) => connection.id);
    expect(new Set(ids).size).toBe(ids.length);
  }

  for (const graphId of graphIds) {
    const graph = model.graphs.get(graphId);
    if (graph === undefined) {
      expect(yield* Effect.flip(persistence.loadGraph(graphId))).toBeInstanceOf(
        Graph.NotFoundError,
      );
    } else {
      expect(yield* persistence.loadGraph(graphId)).toEqual(toCanvas(graphId, graph));
    }

    for (const slot of nodeSlots) {
      const id = nodeId(graphId, slot);
      const node = graph?.nodes.get(id);
      if (node === undefined) {
        expect(yield* Effect.flip(persistence.loadNode(graphId, id))).toBeInstanceOf(
          Node.NotFoundError,
        );
      } else {
        expect(yield* persistence.loadNode(graphId, id)).toEqual(node);
      }
    }
  }
});

const numRuns = Number(process.env.FC_NUM_RUNS ?? 50);
const seed = process.env.FC_SEED === undefined ? 0x6d67 : Number(process.env.FC_SEED);

export const persistenceModelProperty = <E>(layer: Layer.Layer<Persistence.Service, E, never>) =>
  it.effect.prop(
    "agrees with an in-memory model across generated edit sequences",
    [fc.array(commandArb, { maxLength: 25 })],
    ([commands]) =>
      Effect.gen(function* () {
        const persistence = yield* Persistence.Service;
        let model: Model = { name: "Model Project", graphs: new Map() };
        yield* persistence.saveProject(toProject(model));
        yield* checkAgreement(persistence, model);

        for (const [index, command] of commands.entries()) {
          const step = resolve(model, command, index);
          if (step === undefined) continue;

          const before = toProject(model);
          yield* step.run(persistence);
          model = step.next;

          expect(Option.getOrUndefined(Persistence.applyMutation(before, step.mutation))).toEqual(
            toProject(model),
          );
          yield* checkAgreement(persistence, model);
        }
      }).pipe(Effect.provide(layer)),
    { timeout: 60_000, fastCheck: { numRuns, seed } },
  );
