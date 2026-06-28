import { Connection, Graph, Node, Project } from "@macrograph/core";
import { Cause, Context, Data, Effect, Layer, Option, Ref, Schema } from "effect";

export class PersistenceError extends Schema.TaggedErrorClass<PersistenceError>()(
	"PersistenceError",
	{ cause: Schema.Defect() },
) {
	static refail<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, PersistenceError, R> {
		return Effect.catchCause(effect, (cause) =>
			Effect.fail(new PersistenceError({ cause: Cause.squash(cause) })),
		);
	}
}

export class Service extends Context.Service<
	Service,
	{
		readonly saveProject: (project: Project.Model) => Effect.Effect<void, PersistenceError>;
		readonly loadProject: () => Effect.Effect<
			Project.Model,
			Project.NotFoundError | PersistenceError
		>;
		readonly loadGraph: (
			graphId: string,
		) => Effect.Effect<Graph.Model, Graph.NotFoundError | PersistenceError>;
		readonly loadNode: (
			graphId: string,
			nodeId: string,
		) => Effect.Effect<Node.Model, Node.NotFoundError | PersistenceError>;
		readonly saveGraph: (graph: Graph.Model) => Effect.Effect<void, PersistenceError>;
		readonly deleteGraph: (graphId: string) => Effect.Effect<void, PersistenceError>;
		readonly saveNode: (graphId: string, node: Node.Model) => Effect.Effect<void, PersistenceError>;
		readonly deleteNode: (
			graphId: string,
			nodeId: string,
		) => Effect.Effect<void, PersistenceError>;
		readonly saveConnection: (
			graphId: string,
			connection: Connection.Model,
		) => Effect.Effect<void, PersistenceError>;
		readonly deleteConnection: (
			graphId: string,
			connectionId: string,
		) => Effect.Effect<void, PersistenceError>;
	}
>()("macrograph/Persistence") { }

export type ProjectMutation = Data.TaggedEnum<{
	SaveProject: { project: Project.Model };
	SaveGraph: { graph: Graph.Model };
	DeleteGraph: { graphId: string };
	SaveNode: { graphId: string; node: Node.Model };
	DeleteNode: { graphId: string; nodeId: string };
	SaveConnection: { graphId: string; connection: Connection.Model };
	DeleteConnection: { graphId: string; connectionId: string };
}>;

const ProjectMutation = Data.taggedEnum<ProjectMutation>();

export const applyMutation = (
	project: Project.Model,
	mutation: ProjectMutation,
): Option.Option<Project.Model> =>
	ProjectMutation.$match(mutation, {
		SaveProject: ({ project: newProject }) => Option.some(newProject),
		SaveGraph: ({ graph }) =>
			Option.some(
				new Project.Model({
					...project,
					graphs: { ...project.graphs, [graph.id]: graph },
				}),
			),
		DeleteGraph: ({ graphId }) => {
			const { [graphId]: _, ...graphs } = project.graphs;
			return Option.some(new Project.Model({ ...project, graphs }));
		},
		SaveNode: ({ graphId, node }) => {
			const graph = project.graphs[graphId];
			if (!graph) return Option.none();
			return Option.some(
				new Project.Model({
					...project,
					graphs: {
						...project.graphs,
						[graphId]: new Graph.Model({
							...graph,
							nodes: { ...graph.nodes, [node.id]: node },
						}),
					},
				}),
			);
		},
		DeleteNode: ({ graphId, nodeId }) => {
			const graph = project.graphs[graphId];
			if (!graph) return Option.none();
			const { [nodeId]: _, ...nodes } = graph.nodes;
			return Option.some(
				new Project.Model({
					...project,
					graphs: {
						...project.graphs,
						[graphId]: new Graph.Model({ ...graph, nodes }),
					},
				}),
			);
		},
		SaveConnection: ({ graphId, connection }) => {
			const graph = project.graphs[graphId];
			if (!graph) return Option.none();
			const existing = graph.connections.some((c) => c.id === connection.id);
			const connections = existing
				? graph.connections.map((c) => (c.id === connection.id ? connection : c))
				: [...graph.connections, connection];
			return Option.some(
				new Project.Model({
					...project,
					graphs: {
						...project.graphs,
						[graphId]: new Graph.Model({ ...graph, connections }),
					},
				}),
			);
		},
		DeleteConnection: ({ graphId, connectionId }) => {
			const graph = project.graphs[graphId];
			if (!graph) return Option.none();
			return Option.some(
				new Project.Model({
					...project,
					graphs: {
						...project.graphs,
						[graphId]: new Graph.Model({
							...graph,
							connections: graph.connections.filter((c) => c.id !== connectionId),
						}),
					},
				}),
			);
		},
	});

const updateCachedProject = (mutation: ProjectMutation) =>
	(cached: Option.Option<Project.Model>): Option.Option<Project.Model> =>
		Option.match(cached, {
			onNone: () => cached,
			onSome: (project) => applyMutation(project, mutation),
		});

export const withMemoryBuffer = <E, R>(
	persistenceLayer: Layer.Layer<Service, E, R>,
): Layer.Layer<Service, E, R> =>
	Layer.effect(
		Service,
		Effect.gen(function* () {
			const persistence = yield* Service;
			const cache = yield* Ref.make<Option.Option<Project.Model>>(Option.none());
			const graphCache = yield* Ref.make<Map<string, Graph.Model>>(new Map());

			const setProjectCache = (project: Project.Model) =>
				Effect.all([
					Ref.set(cache, Option.some(project)),
					Ref.set(graphCache, new Map(Object.entries(project.graphs))),
				]);

			const updateGraphCache = (mutation: ProjectMutation) =>
				Ref.update(graphCache, (cached) =>
					ProjectMutation.$match(mutation, {
						SaveProject: ({ project }) => new Map(Object.entries(project.graphs)),
						SaveGraph: ({ graph }) => {
							const next = new Map(cached);
							next.set(graph.id, graph);
							return next;
						},
						DeleteGraph: ({ graphId }) => {
							const next = new Map(cached);
							next.delete(graphId);
							return next;
						},
						SaveNode: ({ graphId, node }) => {
							const graph = cached.get(graphId);
							if (!graph) return cached;
							const next = new Map(cached);
							next.set(
								graphId,
								new Graph.Model({
									...graph,
									nodes: { ...graph.nodes, [node.id]: node },
								}),
							);
							return next;
						},
						DeleteNode: ({ graphId, nodeId }) => {
							const graph = cached.get(graphId);
							if (!graph) return cached;
							const { [nodeId]: _, ...nodes } = graph.nodes;
							const next = new Map(cached);
							next.set(graphId, new Graph.Model({ ...graph, nodes }));
							return next;
						},
						SaveConnection: ({ graphId, connection }) => {
							const graph = cached.get(graphId);
							if (!graph) return cached;
							const existing = graph.connections.some((c) => c.id === connection.id);
							const connections = existing
								? graph.connections.map((c) => (c.id === connection.id ? connection : c))
								: [...graph.connections, connection];
							const next = new Map(cached);
							next.set(graphId, new Graph.Model({ ...graph, connections }));
							return next;
						},
						DeleteConnection: ({ graphId, connectionId }) => {
							const graph = cached.get(graphId);
							if (!graph) return cached;
							const next = new Map(cached);
							next.set(
								graphId,
								new Graph.Model({
									...graph,
									connections: graph.connections.filter((c) => c.id !== connectionId),
								}),
							);
							return next;
						},
					}),
				);

			const updateCaches = (mutation: ProjectMutation) =>
				Effect.all([
					Ref.update(cache, updateCachedProject(mutation)),
					updateGraphCache(mutation),
				]);

			return Service.of({
				saveProject: (project) =>
					persistence
						.saveProject(project)
						.pipe(Effect.tap(() => setProjectCache(project))),

				loadProject: () =>
					Effect.gen(function* () {
						const cached = yield* Ref.get(cache);
						if (Option.isSome(cached)) return cached.value;
						const project = yield* persistence.loadProject();
						yield* setProjectCache(project);
						return project;
					}),

			loadGraph: (graphId) =>
				Effect.gen(function* () {
					const cached = yield* Ref.get(graphCache);
					const graph = cached.get(graphId);
					if (graph) return graph;
					const loaded = yield* persistence.loadGraph(graphId);
					yield* Ref.update(graphCache, (cached) => new Map(cached).set(graphId, loaded));
					return loaded;
				}),

			loadNode: (graphId, nodeId) =>
				Effect.gen(function* () {
					const cached = yield* Ref.get(graphCache);
					const graph = cached.get(graphId);
					if (graph) {
						const node = graph.nodes[nodeId];
						if (node) return node;
						return yield* new Node.NotFoundError({ id: nodeId });
					}
					return yield* persistence.loadNode(graphId, nodeId);
				}),

				// deleteProject: () =>
				// 	persistence.deleteProject().pipe(Effect.tap(() => Ref.set(cache, Option.none()))),


				saveGraph: (graph) =>
					persistence.saveGraph(graph).pipe(
						Effect.tap(() => updateCaches(ProjectMutation.SaveGraph({ graph }))),
					),

				deleteGraph: (graphId) =>
					persistence.deleteGraph(graphId).pipe(
						Effect.tap(() => updateCaches(ProjectMutation.DeleteGraph({ graphId }))),
					),

				saveNode: (graphId, node) =>
					persistence.saveNode(graphId, node).pipe(
						Effect.tap(() => updateCaches(ProjectMutation.SaveNode({ graphId, node }))),
					),

				deleteNode: (graphId, nodeId) =>
					persistence.deleteNode(graphId, nodeId).pipe(
						Effect.tap(() => updateCaches(ProjectMutation.DeleteNode({ graphId, nodeId }))),
					),

				saveConnection: (graphId, connection) =>
					persistence.saveConnection(graphId, connection).pipe(
						Effect.tap(() => updateCaches(ProjectMutation.SaveConnection({ graphId, connection }))),
					),

				deleteConnection: (graphId, connectionId) =>
					persistence.deleteConnection(graphId, connectionId).pipe(
						Effect.tap(() => updateCaches(ProjectMutation.DeleteConnection({ graphId, connectionId }))),
					),
			});
		}),
	).pipe(Layer.provide(persistenceLayer));

export const layerMemory = Layer.effect(
	Service,
	Effect.gen(function* () {
		const cache = yield* Ref.make<Option.Option<Project.Model>>(Option.none());

		return Service.of({
			saveProject: (project) => Ref.set(cache, Option.some(project)),
			loadProject: () =>
				Effect.gen(function* () {
					const cached = yield* Ref.get(cache);
					if (Option.isSome(cached)) return cached.value;
					return yield* new Project.NotFoundError();
				}),

		loadGraph: (graphId) =>
			Effect.gen(function* () {
				const cached = yield* Ref.get(cache);
				if (Option.isSome(cached)) {
					const graph = cached.value.graphs[graphId];
					if (graph) return graph;
				}
				return yield* new Graph.NotFoundError({ id: graphId });
			}),

		loadNode: (graphId, nodeId) =>
			Effect.gen(function* () {
				const cached = yield* Ref.get(cache);
				if (Option.isSome(cached)) {
					const node = cached.value.graphs[graphId]?.nodes[nodeId];
					if (node) return node;
				}
				return yield* new Node.NotFoundError({ id: nodeId });
			}),

			// deleteProject: () => Ref.set(cache, Option.none()),

			saveGraph: (graph) =>
				Ref.update(cache, updateCachedProject(ProjectMutation.SaveGraph({ graph }))),

			deleteGraph: (graphId) =>
				Ref.update(cache, updateCachedProject(ProjectMutation.DeleteGraph({ graphId }))),

			saveNode: (graphId, node) =>
				Ref.update(cache, updateCachedProject(ProjectMutation.SaveNode({ graphId, node }))),

			deleteNode: (graphId, nodeId) =>
				Ref.update(cache, updateCachedProject(ProjectMutation.DeleteNode({ graphId, nodeId }))),

			saveConnection: (graphId, connection) =>
				Ref.update(cache, updateCachedProject(ProjectMutation.SaveConnection({ graphId, connection }))),

			deleteConnection: (graphId, connectionId) =>
				Ref.update(cache, updateCachedProject(ProjectMutation.DeleteConnection({ graphId, connectionId }))),
		});
	}),
);

export * as Persistence from "./Persistence.ts";
