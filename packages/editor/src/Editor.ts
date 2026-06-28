import {
	Connection,
	Graph,
	GraphId,
	Node,
	NodeId,
	Package,
	Position,
	Project,
} from "@macrograph/core";
import { Persistence, PersistenceError } from "@macrograph/persistence";
import { Context, Effect, Layer, Semaphore } from "effect";

import { EditorEvent } from "./EditorEvent.ts";
import { EditorEvents } from "./EditorEvents.ts";
import { Packages } from "./Packages.ts";

export class Service extends Context.Service<
	Service,
	{
		readonly createGraph: (
			graph: Graph.CreateInput,
		) => Effect.Effect<EditorEvent.GraphCreated, PersistenceError>;
		readonly deleteGraph: (
			graphId: string,
		) => Effect.Effect<EditorEvent.GraphDeleted, PersistenceError>;
		readonly createNode: (
			graphId: string,
			node: Node.CreateInput,
		) => Effect.Effect<
			EditorEvent.NodeCreated,
			PersistenceError | Graph.NotFoundError | Package.SchemaNotFoundError
		>;
		readonly deleteNode: (
			graphId: string,
			nodeId: string,
		) => Effect.Effect<
			EditorEvent.NodeDeleted,
			PersistenceError | Graph.NotFoundError | Node.NotFoundError
		>;
		readonly setNodeName: (
			graphId: string,
			nodeId: string,
			name: string,
		) => Effect.Effect<
			EditorEvent.NodeNameChanged,
			PersistenceError | Graph.NotFoundError | Node.NotFoundError
		>;
		readonly setNodePosition: (
			graphId: string,
			nodeId: string,
			x: number,
			y: number,
			options?: { ephemeral?: boolean },
		) => Effect.Effect<
			EditorEvent.NodePositionChanged,
			PersistenceError | Graph.NotFoundError | Node.NotFoundError
		>;
		readonly createConnection: (
			graphId: string,
			connection: Connection.CreateInput,
		) => Effect.Effect<
			EditorEvent.ConnectionCreated,
			PersistenceError | Graph.NotFoundError
		>;
		readonly getProject: () => Effect.Effect<
			Project.Model,
			Project.NotFoundError | PersistenceError
		>;
		readonly deleteConnection: (
			graphId: string,
			connectionId: string,
		) => Effect.Effect<EditorEvent.ConnectionDeleted, PersistenceError>;
	}
>()("macrograph/Editor") { }

export const layer = Layer.effect(
	Service,
	Effect.gen(function* () {
		const persistence = yield* Persistence.Service;
		const events = yield* EditorEvents.Service;
		const packages = yield* Packages.Service;

		const lock = yield* Semaphore.make(1);

		const createGraph = Effect.fn("Editor.createGraph")(function* (input: Graph.CreateInput) {
			const graphId = GraphId.make(Math.random().toString(36).slice(2));
			const graph = new Graph.Model({
				id: graphId,
				name: input.name ?? graphId,
				nodes: input.nodes ?? {},
				connections: input.connections ?? [],
			});
			return yield* events.publish(new EditorEvent.GraphCreated({ graphId: graph.id, graph }));
		}, lock.withPermit);

		const deleteGraph = Effect.fn("Editor.deleteGraph")(function* (graphId: string) {
			return yield* events.publish(new EditorEvent.GraphDeleted({ graphId }));
		}, lock.withPermit);

		const createNode = Effect.fn("Editor.createNode")(function* (
			graphId: string,
			input: Node.CreateInput,
		) {
			yield* persistence.loadGraph(graphId);
			yield* packages.getSchema(input.schema);
			const nodeId = NodeId.make(Math.random().toString(36).slice(2));
			const node = new Node.Model({
				id: nodeId,
				name: input.name ?? nodeId,
				properties: input.properties ?? {},
				schema: input.schema,
				position: input.position ?? new Position({ x: 0, y: 0 }),
			});
			return yield* events.publish(new EditorEvent.NodeCreated({ graphId, nodeId: node.id, node }));
		}, lock.withPermit);

		const deleteNode = Effect.fn("Editor.deleteNode")(function* (graphId: string, nodeId: string) {
			const graph = yield* persistence.loadGraph(graphId);
			if (!graph.nodes[nodeId]) return yield* new Node.NotFoundError({ id: nodeId });
			return yield* events.publish(new EditorEvent.NodeDeleted({ graphId, nodeId }));
		}, lock.withPermit);

		const setNodeName = Effect.fn("Editor.setNodeName")(function* (
			graphId: string,
			nodeId: string,
			name: string,
		) {
			const graph = yield* persistence.loadGraph(graphId);
			const node = yield* Graph.getNode(graph, nodeId);
			const updatedNode = new Node.Model({ ...node, name });
			return yield* events.publish(
				new EditorEvent.NodeNameChanged({ graphId, nodeId, name, node: updatedNode }),
			);
		}, lock.withPermit);

		const setNodePosition = Effect.fn("Editor.setNodePosition")(function* (
			graphId: string,
			nodeId: string,
			x: number,
			y: number,
			options?: { ephemeral?: boolean },
		) {
			const graph = yield* persistence.loadGraph(graphId);
			const node = yield* Graph.getNode(graph, nodeId);
			const updatedNode = new Node.Model({
				...node,
				position: new Position({ x, y }),
			});
			const event = new EditorEvent.NodePositionChanged({ graphId, nodeId, x, y, node: updatedNode });
			return yield* options?.ephemeral
				? events.publishEphemeral(event)
				: events.publish(event);
		}, lock.withPermit);

		const createConnection = Effect.fn("Editor.createConnection")(function* (
			graphId: string,
			input: Connection.CreateInput,
		) {
			yield* persistence.loadGraph(graphId);
			const connectionId = Connection.ConnectionId.make(Math.random().toString(36).slice(2));
			const connection = new Connection.Model({
				...input,
				id: connectionId,
			});
			return yield* events.publish(
				new EditorEvent.ConnectionCreated({
					graphId,
					connectionId: connection.id,
					connection,
				}),
			);
		}, lock.withPermit);

		const deleteConnection = Effect.fn("Editor.deleteConnection")(function* (
			graphId: string,
			connectionId: string,
		) {
			return yield* events.publish(new EditorEvent.ConnectionDeleted({ graphId, connectionId }));
		}, lock.withPermit);

		console.log('creating editor')
		const getProject = Effect.fn("Editor.getProject")(function* () {
			console.log("getProject")
			return yield* persistence.loadProject();
		}, lock.withPermit);

		return Service.of({
			createGraph,
			deleteGraph,
			createNode,
			deleteNode,
			setNodeName,
			setNodePosition,
			createConnection,
			deleteConnection,
			getProject,
		});
	}),
);

export const defaultLayer = layer.pipe(
	Layer.provide(EditorEvents.defaultLayer),
);

export * as Editor from "./Editor.ts";
