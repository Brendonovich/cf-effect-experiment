import { Effect, Schema } from "effect";

import { Graph } from "./Graph.ts";

export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"));
export type ProjectId = typeof ProjectId.Type;

export class Model extends Schema.Class<Model>("Project")({
  name: Schema.String,
  graphs: Schema.Record(Schema.String, Graph.Model),
}) {}

export const empty = () =>
  new Model({
    name: "New Project",
    graphs: {},
  });

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()(
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

export * as Project from "./Project.ts";
