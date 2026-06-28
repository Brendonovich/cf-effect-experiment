import {
  Node,
  Position,
  SchemaRef,
  Graph,
  Connection,
  Project,
  NodeId,
  GraphId,
  ConnectionId,
  PackageId,
  SchemaId,
  IoId,
} from "@macrograph/core";
import { Persistence, PersistenceError } from "@macrograph/persistence";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";

import { DrizzleDriver, type DbDriver } from "./DrizzleDriver.ts";
import * as schema from "./schema.ts";

export const layer = Layer.effect(
  Persistence.Service,
  Effect.gen(function* () {
    const { driver: db } = yield* DrizzleDriver.Service;

    const exec = <A>(impl: (db: DbDriver) => A) =>
      Effect.sync(() => impl(db)).pipe(PersistenceError.refail);

    const saveProject = Effect.fnUntraced(function* (project: Project.Model) {
      yield* exec((db) => {
        db.transaction((tx) => {
			tx.delete(schema.projectMeta).run();
			tx.insert(schema.projectMeta).values({ name: project.name }).run();

			tx.delete(schema.connections).run();
			tx.delete(schema.nodes).run();
			tx.delete(schema.graphs).run();

			for (const [graphId, graph] of Object.entries(project.graphs)) {
            tx.insert(schema.graphs).values({ id: graphId, name: graph.name }).run();

            for (const [nodeId, node] of Object.entries(graph.nodes)) {
              tx.insert(schema.nodes)
                .values({
                  id: nodeId,
                  name: node.name,
                  properties: node.properties,
                  schemaPackage: node.schema.package,
                  schemaSchema: node.schema.schema,
                  positionX: node.position.x,
                  positionY: node.position.y,
                  graphId,
                })
                .run();
            }

            for (const connection of graph.connections) {
              tx.insert(schema.connections)
                .values({
                  id: connection.id,
                  outNodeId: connection.outNodeId,
                  outIoId: connection.outIoId,
                  inNodeId: connection.inNodeId,
                  inIoId: connection.inIoId,
                  graphId,
                })
                .run();
            }
          }
        });
      });
    });

    const loadGraphModel = (db: DbDriver, graphRow: typeof schema.graphs.$inferSelect) => {
      const nodeRows = db
        .select()
        .from(schema.nodes)
        .where(eq(schema.nodes.graphId, graphRow.id))
        .all();

      const connectionRows = db
        .select()
        .from(schema.connections)
        .where(eq(schema.connections.graphId, graphRow.id))
        .all();

      const nodes: Record<string, Node.Model> = {};
      for (const nodeRow of nodeRows) {
        nodes[nodeRow.id] = new Node.Model({
          id: NodeId.make(nodeRow.id),
          name: nodeRow.name,
          properties: nodeRow.properties,
          schema: new SchemaRef({
            package: PackageId.make(nodeRow.schemaPackage),
            schema: SchemaId.make(nodeRow.schemaSchema),
          }),
          position: new Position({
            x: nodeRow.positionX,
            y: nodeRow.positionY,
          }),
        });
      }

      const connections: Array<Connection.Model> = [];
      for (const connRow of connectionRows) {
        connections.push(
          new Connection.Model({
            id: ConnectionId.make(connRow.id),
            outNodeId: connRow.outNodeId,
            outIoId: IoId.make(connRow.outIoId),
            inNodeId: connRow.inNodeId,
            inIoId: IoId.make(connRow.inIoId),
          }),
        );
      }

      return new Graph.Model({
        id: GraphId.make(graphRow.id),
        name: graphRow.name,
        nodes,
        connections,
      });
    };

    const loadProject = Effect.fnUntraced(function* () {
      const result = yield* exec((db) => {
        const meta = db.select().from(schema.projectMeta).get();
        if (!meta) return null;

        const graphRows = db.select().from(schema.graphs).all();

        const graphs: Record<string, Graph.Model> = {};
        for (const graphRow of graphRows) {
          graphs[graphRow.id] = loadGraphModel(db, graphRow);
        }

        return { name: meta.name, graphs };
      });

      if (!result) {
        return yield* new Project.NotFoundError({});
      }

      return new Project.Model({
        name: result.name,
        graphs: result.graphs,
      });
    });

    const loadGraph = Effect.fnUntraced(function* (graphId: string) {
      const result = yield* exec((db) => {
        const graphRow = db
          .select()
          .from(schema.graphs)
          .where(eq(schema.graphs.id, graphId))
          .get();
        if (!graphRow) return null;
        return loadGraphModel(db, graphRow);
      });

      if (!result) return yield* new Graph.NotFoundError({ id: graphId });
      return result;
    });

    const loadNode = Effect.fnUntraced(function* (graphId: string, nodeId: string) {
      const result = yield* exec((db) => {
        const nodeRow = db
          .select()
          .from(schema.nodes)
          .where(eq(schema.nodes.id, nodeId))
          .get();
        if (!nodeRow || nodeRow.graphId !== graphId) return null;
        return new Node.Model({
          id: NodeId.make(nodeRow.id),
          name: nodeRow.name,
          properties: nodeRow.properties,
          schema: new SchemaRef({
            package: PackageId.make(nodeRow.schemaPackage),
            schema: SchemaId.make(nodeRow.schemaSchema),
          }),
          position: new Position({
            x: nodeRow.positionX,
            y: nodeRow.positionY,
          }),
        });
      });

      if (!result) return yield* new Node.NotFoundError({ id: nodeId });
      return result;
    });

    const saveGraph = Effect.fnUntraced(function* (graph: Graph.Model) {
      yield* exec((db) => {
        db.transaction((tx) => {
          tx.delete(schema.connections).where(eq(schema.connections.graphId, graph.id)).run();
          tx.delete(schema.nodes).where(eq(schema.nodes.graphId, graph.id)).run();
          tx.delete(schema.graphs).where(eq(schema.graphs.id, graph.id)).run();
          tx.insert(schema.graphs).values({ id: graph.id, name: graph.name }).run();

          for (const [nodeId, node] of Object.entries(graph.nodes)) {
            tx.insert(schema.nodes)
              .values({
                id: nodeId,
                name: node.name,
                properties: node.properties,
                schemaPackage: node.schema.package,
                schemaSchema: node.schema.schema,
                positionX: node.position.x,
                positionY: node.position.y,
                graphId: graph.id,
              })
              .run();
          }

          for (const connection of Object.values(graph.connections)) {
            tx.insert(schema.connections)
              .values({
                id: connection.id,
                outNodeId: connection.outNodeId,
                outIoId: connection.outIoId,
                inNodeId: connection.inNodeId,
                inIoId: connection.inIoId,
                graphId: graph.id,
              })
              .run();
          }
        });
      });
    });

    const deleteGraph = Effect.fnUntraced(function* (graphId: string) {
      yield* exec((db) => {
        db.transaction((tx) => {
          tx.delete(schema.connections).where(eq(schema.connections.graphId, graphId)).run();
          tx.delete(schema.nodes).where(eq(schema.nodes.graphId, graphId)).run();
          tx.delete(schema.graphs).where(eq(schema.graphs.id, graphId)).run();
        });
      });
    });

    const saveNode = Effect.fnUntraced(function* (graphId: string, node: Node.Model) {
      yield* exec((db) => {
        db.transaction((tx) => {
          tx.delete(schema.nodes).where(eq(schema.nodes.id, node.id)).run();
          tx.insert(schema.nodes)
            .values({
              id: node.id,
              name: node.name,
              properties: node.properties,
              schemaPackage: node.schema.package,
              schemaSchema: node.schema.schema,
              positionX: node.position.x,
              positionY: node.position.y,
              graphId,
            })
            .run();
        });
      });
    });

    const deleteNode = Effect.fnUntraced(function* (_graphId: string, nodeId: string) {
      yield* exec((db) => {
        db.delete(schema.nodes).where(eq(schema.nodes.id, nodeId)).run();
      });
    });

    const saveConnection = Effect.fnUntraced(function* (
      graphId: string,
      connection: Connection.Model,
    ) {
      yield* exec((db) => {
        db.transaction((tx) => {
          tx.delete(schema.connections).where(eq(schema.connections.id, connection.id)).run();
          tx.insert(schema.connections)
            .values({
              id: connection.id,
              outNodeId: connection.outNodeId,
              outIoId: connection.outIoId,
              inNodeId: connection.inNodeId,
              inIoId: connection.inIoId,
              graphId,
            })
            .run();
        });
      });
    });

    const deleteConnection = Effect.fnUntraced(function* (_graphId: string, connectionId: string) {
      yield* exec((db) => {
        db.delete(schema.connections).where(eq(schema.connections.id, connectionId)).run();
      });
    });

    return Persistence.Service.of({
      saveProject,
      loadProject,
      loadGraph,
      loadNode,
      // deleteProject,
      saveGraph,
      deleteGraph,
      saveNode,
      deleteNode,
      saveConnection,
      deleteConnection,
    });
  }),
);

export * as SqlitePersistence from "./SqlitePersistence.ts";
