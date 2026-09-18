import {
  Node,
  Canvas,
  Graph,
  Connection,
  Project,
  NodeId,
  CanvasId,
  ConnectionId,
  PackageId,
  SchemaId,
  IoId,
  Function as GraphFunction,
} from "@macrograph/core";
import { Persistence, PersistenceError } from "@macrograph/persistence";
import { eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";

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
          tx.insert(schema.projectMeta)
            .values({
              name: project.name,
              engines: project.engines,
              constants: project.constants,
              types: project.types,
            })
            .run();

          tx.delete(schema.connections).run();
          tx.delete(schema.nodes).run();
          tx.delete(schema.graphs).run();
          tx.delete(schema.functions).run();
          tx.delete(schema.canvases).run();

          for (const [graphId, graph] of Object.entries(Project.canvases(project))) {
            tx.insert(schema.canvases).values({ id: graphId, name: graph.name }).run();
            if (project.graphs[graphId] !== undefined)
              tx.insert(schema.graphs).values({ canvasId: graphId }).run();

            for (const [nodeId, node] of Object.entries(graph.nodes)) {
              tx.insert(schema.nodes)
                .values({
                  id: nodeId,
                  name: node.name,
                  properties: node.properties,
                  inputDefaults: node.inputDefaults,
                  foldPins: node.foldPins,
                  splitScopeOutputs: node.splitScopeOutputs ?? null,
                  schemaPackage: node.schema.package,
                  schemaSchema: node.schema.schema,
                  positionX: node.position.x,
                  positionY: node.position.y,
                  canvasId: graphId,
                })
                .run();
            }

            for (const connection of graph.connections) {
              tx.insert(schema.connections)
                .values({
                  id: connection.id,
                  outNodeId: connection.outNodeId,
                  outIo: connection.outIo,
                  inNodeId: connection.inNodeId,
                  inIoId: connection.inIoId,
                  canvasId: graphId,
                })
                .run();
            }
          }

          for (const fn of Object.values(project.functions)) {
            tx.insert(schema.functions)
              .values({
                canvasId: fn.canvas.id,
                arguments: fn.arguments,
                returns: fn.returns,
                inputPosition: fn.inputPosition,
                outputPosition: fn.outputPosition,
              })
              .run();
          }
        });
      });
    });

    const loadGraphModel = (
      graphRow: typeof schema.canvases.$inferSelect,
      nodeRows: Array<typeof schema.nodes.$inferSelect>,
      connectionRows: Array<typeof schema.connections.$inferSelect>,
    ) => {
      const nodes: Record<string, Node.Model> = {};
      for (const nodeRow of nodeRows) {
        nodes[nodeRow.id] = {
          id: NodeId.make(nodeRow.id),
          name: nodeRow.name,
          properties: nodeRow.properties,
          inputDefaults: nodeRow.inputDefaults,
          foldPins: nodeRow.foldPins,
          ...(nodeRow.splitScopeOutputs === null
            ? {}
            : { splitScopeOutputs: nodeRow.splitScopeOutputs }),
          schema: {
            package: PackageId.make(nodeRow.schemaPackage),
            schema: SchemaId.make(nodeRow.schemaSchema),
          },
          position: {
            x: nodeRow.positionX,
            y: nodeRow.positionY,
          },
        };
      }

      const connections: Array<Connection.Model> = [];
      for (const connRow of connectionRows) {
        connections.push({
          id: ConnectionId.make(connRow.id),
          outNodeId: connRow.outNodeId,
          outIo: connRow.outIo,
          inNodeId: connRow.inNodeId,
          inIoId: IoId.make(connRow.inIoId),
        });
      }

      return {
        id: CanvasId.make(graphRow.id),
        name: graphRow.name,
        nodes,
        connections,
      };
    };

    const loadProject = Effect.fnUntraced(function* () {
      const result = yield* exec((db) => {
        const meta = db.select().from(schema.projectMeta).get();
        if (!meta) return null;

        const canvasRows = db.select().from(schema.canvases).all();
        const graphRows = db.select().from(schema.graphs).all();
        const nodeRows = db.select().from(schema.nodes).all();
        const connectionRows = db.select().from(schema.connections).all();
        const functionRows = db.select().from(schema.functions).all();

        const nodesByGraph = new Map<string, Array<typeof schema.nodes.$inferSelect>>();
        for (const nodeRow of nodeRows) {
          let rows = nodesByGraph.get(nodeRow.canvasId);
          if (!rows) nodesByGraph.set(nodeRow.canvasId, (rows = []));
          rows.push(nodeRow);
        }

        const connectionsByGraph = new Map<string, Array<typeof schema.connections.$inferSelect>>();
        for (const connectionRow of connectionRows) {
          let rows = connectionsByGraph.get(connectionRow.canvasId);
          if (!rows) connectionsByGraph.set(connectionRow.canvasId, (rows = []));
          rows.push(connectionRow);
        }

        const canvases: Record<string, Canvas.Model> = {};
        for (const canvasRow of canvasRows) {
          canvases[canvasRow.id] = loadGraphModel(
            canvasRow,
            nodesByGraph.get(canvasRow.id) ?? [],
            connectionsByGraph.get(canvasRow.id) ?? [],
          );
        }

        const graphs: Record<string, Graph.Model> = {};
        const functions: Record<string, GraphFunction.Model> = {};
        const functionRowsByCanvas = new Map(functionRows.map((row) => [row.canvasId, row]));
        const graphCanvasIds = new Set(graphRows.map((row) => row.canvasId));
        for (const canvasRow of canvasRows) {
          const functionRow = functionRowsByCanvas.get(canvasRow.id);
          const isGraph = graphCanvasIds.has(canvasRow.id);
          if (isGraph === (functionRow !== undefined))
            throw new Error(
              `Canvas ${canvasRow.id} must have exactly one graph or function subtype`,
            );
          const canvas = canvases[canvasRow.id];
          if (canvas === undefined) throw new Error(`Canvas ${canvasRow.id} is missing`);
          if (functionRow === undefined) {
            graphs[canvasRow.id] = { canvas };
            continue;
          }
          functions[functionRow.canvasId] = {
            canvas,
            arguments: functionRow.arguments.map((field) => ({
              ...field,
              id: IoId.make(field.id),
            })),
            returns: functionRow.returns.map((field) => ({
              ...field,
              id: IoId.make(field.id),
            })),
            inputPosition: functionRow.inputPosition,
            outputPosition: functionRow.outputPosition,
          };
        }

        return {
          name: meta.name,
          graphs,
          functions,
          engines: meta.engines,
          constants: meta.constants,
          types: meta.types,
        };
      });

      if (!result) {
        return yield* new Project.NotFoundError({});
      }

      return yield* Schema.decodeUnknownEffect(Project.Model)({
        name: result.name,
        graphs: result.graphs,
        functions: result.functions,
        engines: result.engines,
        constants: result.constants,
        types: result.types,
      }).pipe(PersistenceError.refail);
    });

    const loadGraph = Effect.fnUntraced(function* (graphId: string) {
      const result = yield* exec((db) => {
        const graphRow = db
          .select()
          .from(schema.canvases)
          .where(eq(schema.canvases.id, graphId))
          .get();
        if (!graphRow) return null;

        const nodeRows = db
          .select()
          .from(schema.nodes)
          .where(eq(schema.nodes.canvasId, graphRow.id))
          .all();

        const connectionRows = db
          .select()
          .from(schema.connections)
          .where(eq(schema.connections.canvasId, graphRow.id))
          .all();

        return loadGraphModel(graphRow, nodeRows, connectionRows);
      });

      if (!result) return yield* new Graph.NotFoundError({ id: graphId });
      return yield* Schema.decodeUnknownEffect(Canvas.Model)(result).pipe(PersistenceError.refail);
    });

    const loadNode = Effect.fnUntraced(function* (graphId: string, nodeId: string) {
      const result = yield* exec((db) => {
        const nodeRow = db.select().from(schema.nodes).where(eq(schema.nodes.id, nodeId)).get();
        if (!nodeRow || nodeRow.canvasId !== graphId) return null;
        return {
          id: NodeId.make(nodeRow.id),
          name: nodeRow.name,
          properties: nodeRow.properties,
          inputDefaults: nodeRow.inputDefaults,
          foldPins: nodeRow.foldPins,
          ...(nodeRow.splitScopeOutputs === null
            ? {}
            : { splitScopeOutputs: nodeRow.splitScopeOutputs }),
          schema: {
            package: PackageId.make(nodeRow.schemaPackage),
            schema: SchemaId.make(nodeRow.schemaSchema),
          },
          position: {
            x: nodeRow.positionX,
            y: nodeRow.positionY,
          },
        };
      });

      if (!result) return yield* new Node.NotFoundError({ id: nodeId });
      return yield* Schema.decodeUnknownEffect(Node.Model)(result).pipe(PersistenceError.refail);
    });

    const saveGraph = Effect.fnUntraced(function* (graph: Canvas.Model) {
      yield* exec((db) => {
        db.transaction((tx) => {
          tx.delete(schema.connections).where(eq(schema.connections.canvasId, graph.id)).run();
          tx.delete(schema.nodes).where(eq(schema.nodes.canvasId, graph.id)).run();
          tx.insert(schema.canvases)
            .values({ id: graph.id, name: graph.name })
            .onConflictDoUpdate({ target: schema.canvases.id, set: { name: graph.name } })
            .run();
          const functionRow = tx
            .select({ canvasId: schema.functions.canvasId })
            .from(schema.functions)
            .where(eq(schema.functions.canvasId, graph.id))
            .get();
          if (functionRow === undefined)
            tx.insert(schema.graphs).values({ canvasId: graph.id }).onConflictDoNothing().run();

          for (const [nodeId, node] of Object.entries(graph.nodes)) {
            tx.insert(schema.nodes)
              .values({
                id: nodeId,
                name: node.name,
                properties: node.properties,
                inputDefaults: node.inputDefaults,
                foldPins: node.foldPins,
                splitScopeOutputs: node.splitScopeOutputs ?? null,
                schemaPackage: node.schema.package,
                schemaSchema: node.schema.schema,
                positionX: node.position.x,
                positionY: node.position.y,
                canvasId: graph.id,
              })
              .run();
          }

          for (const connection of Object.values(graph.connections)) {
            tx.insert(schema.connections)
              .values({
                id: connection.id,
                outNodeId: connection.outNodeId,
                outIo: connection.outIo,
                inNodeId: connection.inNodeId,
                inIoId: connection.inIoId,
                canvasId: graph.id,
              })
              .run();
          }
        });
      });
    });

    const deleteGraph = Effect.fnUntraced(function* (graphId: string) {
      yield* exec((db) => {
        db.transaction((tx) => {
          tx.delete(schema.connections).where(eq(schema.connections.canvasId, graphId)).run();
          tx.delete(schema.nodes).where(eq(schema.nodes.canvasId, graphId)).run();
          tx.delete(schema.graphs).where(eq(schema.graphs.canvasId, graphId)).run();
          tx.delete(schema.functions).where(eq(schema.functions.canvasId, graphId)).run();
          tx.delete(schema.canvases).where(eq(schema.canvases.id, graphId)).run();
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
              inputDefaults: node.inputDefaults,
              foldPins: node.foldPins,
              splitScopeOutputs: node.splitScopeOutputs ?? null,
              schemaPackage: node.schema.package,
              schemaSchema: node.schema.schema,
              positionX: node.position.x,
              positionY: node.position.y,
              canvasId: graphId,
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
              outIo: connection.outIo,
              inNodeId: connection.inNodeId,
              inIoId: connection.inIoId,
              canvasId: graphId,
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
