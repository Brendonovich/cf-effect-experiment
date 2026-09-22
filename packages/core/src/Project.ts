import { DataType } from "@macrograph/module/DataType";
import { Effect, Schema } from "effect";

import { Canvas } from "./Canvas.ts";
import { Function as GraphFunction } from "./Function.ts";
import { Graph } from "./Graph.ts";
import { Collection as Queues } from "./Queue.ts";
import { Collection as ResourceConstants } from "./ResourceConstant.ts";

export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"));
export type ProjectId = typeof ProjectId.Type;

export const Model = Schema.Struct({
  name: Schema.String,
  graphs: Schema.Record(Schema.String, Graph.Model),
  functions: GraphFunction.Collection,
  engines: Schema.Record(Schema.String, Schema.Json).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
  constants: ResourceConstants,
  queues: Queues,
  types: DataType.Definitions.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
});
export type Model = typeof Model.Type;

export const empty = (): Model => ({
  name: "New Project",
  graphs: {},
  functions: {},
  engines: {},
  constants: {},
  queues: {},
  types: {},
});

export class NotFoundError extends Schema.TaggedError<NotFoundError>()(
  "ProjectNotFoundError",
  {},
) {}

export const getGraph = (
  project: Model,
  graphId: string,
): Effect.Effect<Graph.Model, Graph.NotFoundError> => {
  const graph = project.graphs[graphId];
  if (graph) return Effect.succeed(graph);
  return Effect.fail(new Graph.NotFoundError({ id: graphId }));
};

export const getFunction = (
  project: Model,
  canvasId: string,
): Effect.Effect<GraphFunction.Model, GraphFunction.NotFoundError> => {
  const fn = project.functions[canvasId];
  if (fn) return Effect.succeed(fn);
  return Effect.fail(new GraphFunction.NotFoundError({ canvasId }));
};

export const getCanvas = (
  project: Model,
  canvasId: string,
): Effect.Effect<Canvas.Model, Canvas.NotFoundError> => {
  const canvas = project.graphs[canvasId]?.canvas ?? project.functions[canvasId]?.canvas;
  if (canvas) return Effect.succeed(canvas);
  return Effect.fail(new Canvas.NotFoundError({ id: canvasId }));
};

export const canvases = (project: Model): Readonly<Record<string, Canvas.Model>> => ({
  ...Object.fromEntries(Object.entries(project.graphs).map(([id, graph]) => [id, graph.canvas])),
  ...Object.fromEntries(Object.entries(project.functions).map(([id, fn]) => [id, fn.canvas])),
});

export const replaceCanvas = (project: Model, canvas: Canvas.Model): Model => {
  const graph = project.graphs[canvas.id];
  if (graph !== undefined)
    return {
      ...project,
      graphs: { ...project.graphs, [canvas.id]: { ...graph, canvas } },
    };
  const fn = project.functions[canvas.id];
  if (fn !== undefined)
    return {
      ...project,
      functions: { ...project.functions, [canvas.id]: { ...fn, canvas } },
    };
  return project;
};

export * as Project from "./Project.ts";
