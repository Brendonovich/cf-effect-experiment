import { Effect, Schema } from "effect";

import { Graph } from "./Graph.ts";
import { Collection as ResourceConstants } from "./ResourceConstant.ts";

export const ProjectId = Schema.String.pipe(Schema.brand("ProjectId"));
export type ProjectId = typeof ProjectId.Type;

export const Model = Schema.Struct({
  name: Schema.String,
  graphs: Schema.Record(Schema.String, Graph.Model),
  engines: Schema.Record(Schema.String, Schema.Json).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
  constants: ResourceConstants,
});
export type Model = typeof Model.Type;

export const empty = (): Model => ({
  name: "New Project",
  graphs: {},
  engines: {},
  constants: {},
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

export * as Project from "./Project.ts";
