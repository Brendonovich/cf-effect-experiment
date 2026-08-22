import {
  Connection,
  Graph,
  GraphId,
  IoId,
  Node,
  NodeId,
  Package,
  PackageId,
  Project,
  SchemaId,
} from "@macrograph/core";
import { Persistence, PersistenceError } from "@macrograph/persistence";
import { HttpEndpoint, Registration, type Engine, type Plugin } from "@macrograph/plugin";
import { Context, Effect, Layer, Ref, Schema, Semaphore } from "effect";

import { EditorEvent } from "./EditorEvent.ts";
import { EditorEvents } from "./EditorEvents.ts";
import { Packages } from "./Packages.ts";

type GraphUpdateOptions = {
  readonly graphID: string;
  readonly name: string;
};

type NodeCreateOptions = {
  readonly graphID: string;
  readonly node: Node.CreateInput;
};

type NodeUpdateOptions = {
  readonly graphID: string;
  readonly nodeID: string;
  readonly name?: string;
  readonly position?: { readonly x: number; readonly y: number };
  readonly ephemeral?: boolean;
  readonly clientId?: string;
};

type NodeDeleteOptions = {
  readonly graphID: string;
  readonly nodeID: string;
};

type NodeMutationError = PersistenceError | Graph.NotFoundError | Node.NotFoundError;

export class EngineNotRegistered extends Schema.TaggedErrorClass<EngineNotRegistered>()(
  "EngineNotRegistered",
  { pluginId: Schema.String },
) {}

export class EngineNotHosted extends Schema.TaggedErrorClass<EngineNotHosted>()(
  "EngineNotHosted",
  { pluginId: Schema.String },
) {}

export class InvalidEngineState extends Schema.TaggedErrorClass<InvalidEngineState>()(
  "InvalidEngineState",
  { pluginId: Schema.String, cause: Schema.Unknown },
) {}

export interface Interface {
  readonly project: {
    readonly get: () => Effect.Effect<Project.Model, Project.NotFoundError | PersistenceError>;
  };
  readonly graph: {
    readonly create: (
      graph: Graph.CreateInput,
    ) => Effect.Effect<EditorEvent.GraphCreated, PersistenceError>;
    readonly update: (
      options: GraphUpdateOptions,
    ) => Effect.Effect<void, PersistenceError | Graph.NotFoundError>;
    readonly delete: (options: {
      readonly graphID: string;
    }) => Effect.Effect<EditorEvent.GraphDeleted, PersistenceError>;
  };
  readonly node: {
    readonly create: (
      options: NodeCreateOptions,
    ) => Effect.Effect<
      EditorEvent.NodeCreated,
      PersistenceError | Graph.NotFoundError | Package.SchemaNotFoundError
    >;
    readonly update: (options: NodeUpdateOptions) => Effect.Effect<void, NodeMutationError>;
    readonly delete: (
      options: NodeDeleteOptions,
    ) => Effect.Effect<EditorEvent.NodeDeleted, NodeMutationError>;
  };
  readonly connection: {
    readonly create: (options: {
      readonly graphID: string;
      readonly connection: Connection.CreateInput;
    }) => Effect.Effect<
      EditorEvent.ConnectionCreated,
      | PersistenceError
      | Graph.NotFoundError
      | Node.NotFoundError
      | Package.SchemaNotFoundError
      | Connection.InvalidError
    >;
    readonly delete: (options: {
      readonly graphID: string;
      readonly connectionId: string;
    }) => Effect.Effect<EditorEvent.ConnectionDeleted, PersistenceError>;
  };
  readonly engine: {
    readonly setState: (
      pluginId: string,
      state: unknown,
    ) => Effect.Effect<
      EditorEvent.EngineStateChanged,
      PersistenceError | EngineNotRegistered | InvalidEngineState
    >;
    readonly getEndpoints: () => Effect.Effect<ReadonlyArray<HttpEndpoint.Routed>>;
    readonly setEndpoints: (endpoints: ReadonlyArray<HttpEndpoint.Routed>) => Effect.Effect<void>;
    readonly hostClientState: (
      pluginId: string,
      state: Effect.Effect<unknown>,
    ) => Effect.Effect<void>;
    readonly getClientState: (
      pluginId: string,
    ) => Effect.Effect<unknown, EngineNotHosted>;
  };
  readonly plugin: <Definition extends Engine.AnyDef = never>(
    ...args: Plugin.RegisterArgs<Definition>
  ) => Effect.Effect<void>;
}

export class Service extends Context.Service<Service, Interface>()("macrograph/Editor") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const persistence = yield* Persistence.Service;
    const events = yield* EditorEvents.Service;
    const packages = yield* Packages.Service;
    const lock = yield* Semaphore.make(1);
    const engines = yield* Ref.make<ReadonlyMap<string, Engine.AnyDef>>(new Map());
    const engineClientStates = yield* Ref.make<ReadonlyMap<string, Effect.Effect<unknown>>>(
      new Map(),
    );
    const engineEndpoints = yield* Ref.make<ReadonlyArray<HttpEndpoint.Routed>>([]);

    const graphCreate = Effect.fn("Editor.graph.create")(function* (input: Graph.CreateInput) {
      const graphId = GraphId.make(Math.random().toString(36).slice(2));
      const graph: Graph.Model = {
        id: graphId,
        name: input.name ?? graphId,
        nodes: input.nodes ?? {},
        connections: input.connections ?? [],
      };
      return yield* events.publish({ _tag: "GraphCreated", graph });
    }, lock.withPermit);

    const graphUpdate = Effect.fn("Editor.graph.update")(function* (options: GraphUpdateOptions) {
      const graph = yield* persistence.loadGraph(options.graphID);
      yield* persistence.saveGraph({ ...graph, name: options.name });
    }, lock.withPermit);

    const graphDelete = Effect.fn("Editor.graph.delete")(function* (options: {
      readonly graphID: string;
    }) {
      return yield* events.publish({ _tag: "GraphDeleted", graphId: options.graphID });
    }, lock.withPermit);

    const nodeCreate = Effect.fn("Editor.node.create")(function* (options: NodeCreateOptions) {
      yield* persistence.loadGraph(options.graphID);
      yield* packages.getSchema(options.node.schema);
      const nodeId = NodeId.make(Math.random().toString(36).slice(2));
      const node: Node.Model = {
        id: nodeId,
        name: options.node.name ?? nodeId,
        properties: options.node.properties ?? {},
        schema: options.node.schema,
        position: options.node.position ?? { x: 0, y: 0 },
      };
      return yield* events.publish({ _tag: "NodeCreated", graphId: options.graphID, node });
    }, lock.withPermit);

    const nodeUpdate = Effect.fn("Editor.node.update")(function* (options: NodeUpdateOptions) {
      const graph = yield* persistence.loadGraph(options.graphID);
      yield* Graph.getNode(graph, options.nodeID);

      if (options.name !== undefined) {
        yield* events.publish({
          _tag: "NodeNameChanged",
          graphId: options.graphID,
          nodeId: options.nodeID,
          name: options.name,
        });
      }

      if (options.position !== undefined) {
        const event: EditorEvent.NodePositionChanged = {
          _tag: "NodePositionChanged",
          graphId: options.graphID,
          nodeId: options.nodeID,
          x: options.position.x,
          y: options.position.y,
          ...(options.clientId !== undefined ? { clientId: options.clientId } : {}),
        };
        yield* options.ephemeral ? events.publishEphemeral(event) : events.publish(event);
      }
    }, lock.withPermit);

    const nodeDelete = Effect.fn("Editor.node.delete")(function* (options: NodeDeleteOptions) {
      const graph = yield* persistence.loadGraph(options.graphID);
      yield* Graph.getNode(graph, options.nodeID);
      return yield* events.publish({
        _tag: "NodeDeleted",
        graphId: options.graphID,
        nodeId: options.nodeID,
      });
    }, lock.withPermit);

    const connectionCreate = Effect.fn("Editor.connection.create")(function* (options: {
      readonly graphID: string;
      readonly connection: Connection.CreateInput;
    }) {
      const graph = yield* persistence.loadGraph(options.graphID);
      const outNode = yield* Graph.getNode(graph, options.connection.outNodeId);
      const inNode = yield* Graph.getNode(graph, options.connection.inNodeId);
      const outSchema = yield* packages.getSchema(outNode.schema);
      const inSchema = yield* packages.getSchema(inNode.schema);

      if (!outSchema.executionOutputs.some((output) => output.id === options.connection.outIoId))
        return yield* new Connection.InvalidError({ reason: "Execution output does not exist" });
      if (!inSchema.executionInputs.some((input) => input.id === options.connection.inIoId))
        return yield* new Connection.InvalidError({ reason: "Execution input does not exist" });
      if (
        graph.connections.some(
          (connection) =>
            connection.outNodeId === options.connection.outNodeId &&
            connection.outIoId === options.connection.outIoId,
        )
      )
        return yield* new Connection.InvalidError({
          reason: "Execution output already has a connection",
        });

      const connection: Connection.Model = {
        ...options.connection,
        id: Connection.ConnectionId.make(Math.random().toString(36).slice(2)),
      };
      return yield* events.publish({
        _tag: "ConnectionCreated",
        graphId: options.graphID,
        connection,
      });
    }, lock.withPermit);

    const connectionDelete = Effect.fn("Editor.connection.delete")(function* (options: {
      readonly graphID: string;
      readonly connectionId: string;
    }) {
      return yield* events.publish({
        _tag: "ConnectionDeleted",
        graphId: options.graphID,
        connectionId: options.connectionId,
      });
    }, lock.withPermit);

    const projectGet = Effect.fn("Editor.project.get")(function* () {
      return yield* persistence.loadProject();
    }, lock.withPermit);

    const engineSetState = Effect.fn("Editor.engine.setState")(function* (
      pluginId: string,
      state: unknown,
    ) {
      const definition = (yield* Ref.get(engines)).get(pluginId);
      if (definition === undefined) return yield* new EngineNotRegistered({ pluginId });
      const decoded = yield* Schema.decodeUnknownEffect(definition.Storage)(state).pipe(
        Effect.mapError((cause) => new InvalidEngineState({ pluginId, cause })),
      );
      return yield* events.publish({ _tag: "EngineStateChanged", pluginId, state: decoded });
    }, lock.withPermit);

    const plugin: Interface["plugin"] = (...args) =>
      Effect.gen(function* () {
        const [definition, deployment] = args;
        if (
          definition.engine !== undefined &&
          (deployment === undefined ||
            deployment.pluginId !== definition.id ||
            deployment.definition !== definition.engine)
        )
          return yield* Effect.die(`Deployment does not match plugin ${definition.id}`);
        const schemas = yield* Registration.collect(definition.effect);
        yield* packages.loadPackage({
          id: PackageId.make(definition.id),
          name: definition.name ?? definition.id,
          schemas: schemas.map((schema) => ({
            id: SchemaId.make(schema.id),
            name: schema.name,
            type: schema.type,
            executionInputs: schema.executionInputs.map((input) => ({
              id: IoId.make(input.id),
              ...(input.name === undefined ? {} : { name: input.name }),
            })),
            executionOutputs: schema.executionOutputs.map((output) => ({
              id: IoId.make(output.id),
              ...(output.name === undefined ? {} : { name: output.name }),
            })),
          })),
        });
        const engine = definition.engine;
        if (engine !== undefined)
          yield* Ref.update(engines, (current) => {
            const next = new Map(current);
            next.set(definition.id, engine);
            return next;
          });
      }).pipe(lock.withPermit);

    return Service.of({
      project: { get: projectGet },
      graph: { create: graphCreate, update: graphUpdate, delete: graphDelete },
      node: { create: nodeCreate, update: nodeUpdate, delete: nodeDelete },
      connection: { create: connectionCreate, delete: connectionDelete },
      engine: {
        setState: engineSetState,
        getEndpoints: () => Ref.get(engineEndpoints),
        setEndpoints: (endpoints) => Ref.set(engineEndpoints, endpoints),
        hostClientState: (pluginId, state) =>
          Ref.update(engineClientStates, (current) => {
            const next = new Map(current);
            next.set(pluginId, state);
            return next;
          }),
        getClientState: (pluginId) =>
          Ref.get(engineClientStates).pipe(
            Effect.flatMap((states) => {
              const state = states.get(pluginId);
              return state === undefined ? new EngineNotHosted({ pluginId }) : state;
            }),
          ),
      },
      plugin,
    });
  }),
);

export const defaultLayer = layer.pipe(Layer.provide(EditorEvents.defaultLayer));

export * as Editor from "./Editor.ts";
