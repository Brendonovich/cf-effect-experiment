import {
  Connection,
  Graph,
  GraphId,
  Node,
  NodeId,
  Package,
  PackageId,
  Project,
  SchemaId,
  Plugin,
} from "@macrograph/core";
import { Persistence, PersistenceError } from "@macrograph/persistence";
import { Context, Effect, Layer, Ref, Semaphore } from "effect";
import { Rpc } from "effect/unstable/rpc";

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
    }) => Effect.Effect<EditorEvent.ConnectionCreated, PersistenceError | Graph.NotFoundError>;
    readonly delete: (options: {
      readonly graphID: string;
      readonly connectionId: string;
    }) => Effect.Effect<EditorEvent.ConnectionDeleted, PersistenceError>;
  };
  readonly plugin: <Engines extends Record<string, Plugin.Engine.Def<Rpc.Any>>>(
    plugin: Plugin.Plugin<Engines>,
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
      yield* persistence.loadGraph(options.graphID);
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

    const plugin: Interface["plugin"] = (definition) =>
      Effect.gen(function* () {
        const schemas = yield* Ref.make<ReadonlyArray<Package.SchemaModel>>([]);
        yield* definition.effect({
          schema: {
            register: (schema) =>
              Ref.update(schemas, (registered) => [
                ...registered.filter((item) => item.id !== schema.id),
                { id: SchemaId.make(schema.id), name: schema.name ?? schema.id },
              ]),
          },
        });
        yield* packages.loadPackage({
          id: PackageId.make(definition.id),
          name: definition.name ?? definition.id,
          schemas: yield* Ref.get(schemas),
        });
      }).pipe(lock.withPermit);

    return Service.of({
      project: { get: projectGet },
      graph: { create: graphCreate, update: graphUpdate, delete: graphDelete },
      node: { create: nodeCreate, update: nodeUpdate, delete: nodeDelete },
      connection: { create: connectionCreate, delete: connectionDelete },
      plugin,
    });
  }),
);

export const defaultLayer = layer.pipe(Layer.provide(EditorEvents.defaultLayer));

export * as Editor from "./Editor.ts";
