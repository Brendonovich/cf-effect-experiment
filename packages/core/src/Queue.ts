import { Effect, Schema } from "effect";

import type { Model as NodeModel } from "./Node.ts";
import type { Model as PackageModel } from "./Package.ts";

import { Function as GraphFunction } from "./Function.ts";
import { PackageId, SchemaId } from "./SchemaRef.ts";

export const QueueId = Schema.String.pipe(Schema.brand("QueueId"));
export type QueueId = typeof QueueId.Type;
export const Model = Schema.Struct({ id: QueueId, name: Schema.String, functionId: Schema.String });
export type Model = typeof Model.Type;
export const Collection = Schema.Record(Schema.String, Model).pipe(
  Schema.withDecodingDefaultKey(Effect.succeed({})),
);
export const Item = Schema.Struct({ id: Schema.String });
export const State = Schema.Struct({
  queueId: Schema.String,
  paused: Schema.Boolean,
  waiting: Schema.Array(Item),
  running: Schema.Array(Item),
});
export type State = typeof State.Type;

export const packageId = PackageId.make("macrograph-queues");
export const EnqueueSchemaId = SchemaId.make("add");
export const isEnqueue = (node: Pick<NodeModel, "schema">): boolean =>
  node.schema.package === packageId && node.schema.schema === EnqueueSchemaId;
export const enqueueIO = (
  queue: Model | undefined,
  functions: Readonly<Record<string, GraphFunction.Model>>,
) => GraphFunction.callIO(queue === undefined ? undefined : functions[queue.functionId]);
export const packageModel: PackageModel = {
  id: packageId,
  name: "Queues",
  resources: [],
  schemas: [
    {
      id: EnqueueSchemaId,
      name: "Add to Queue",
      type: "exec",
      properties: [{ id: "queue", name: "Queue", type: { _tag: "String" }, optional: true }],
      ...GraphFunction.callIO(undefined),
    },
  ],
};
export class NotFoundError extends Schema.TaggedError<NotFoundError>()("QueueNotFoundError", {
  id: Schema.String,
}) {}
export class OperationError extends Schema.TaggedError<OperationError>()("QueueOperationError", {
  queueId: Schema.String,
  reason: Schema.String,
}) {}
export class RecursiveEnqueueError extends Schema.TaggedError<RecursiveEnqueueError>()(
  "QueueRecursiveEnqueueError",
  { queueId: Schema.String, targetQueueId: Schema.String },
) {}

type ProjectQueues = {
  readonly queues: Readonly<Record<string, Model>>;
  readonly functions: Readonly<Record<string, GraphFunction.Model>>;
};

const targets = (queue: Model, project: ProjectQueues): ReadonlyArray<string> => {
  const fn = project.functions[queue.functionId];
  return fn === undefined
    ? []
    : Object.values(fn.canvas.nodes).flatMap((node) => {
        const target = node.properties.queue;
        return isEnqueue(node) && typeof target === "string" ? [target] : [];
      });
};

export const validateProject = (
  project: ProjectQueues,
): Effect.Effect<void, GraphFunction.NotFoundError | NotFoundError | RecursiveEnqueueError> =>
  Effect.gen(function* () {
    for (const queue of Object.values(project.queues)) {
      if (project.functions[queue.functionId] === undefined)
        return yield* new GraphFunction.NotFoundError({ canvasId: queue.functionId });
      for (const target of targets(queue, project))
        if (project.queues[target] === undefined) return yield* new NotFoundError({ id: target });
    }
    const visit = (
      origin: string,
      current: string,
      visited: ReadonlySet<string>,
    ): RecursiveEnqueueError | undefined => {
      if (visited.has(current)) return undefined;
      const queue = project.queues[current];
      if (queue === undefined) return undefined;
      for (const target of targets(queue, project)) {
        if (target === origin)
          return new RecursiveEnqueueError({ queueId: origin, targetQueueId: target });
        const error = visit(origin, target, new Set([...visited, current]));
        if (error !== undefined) return error;
      }
      return undefined;
    };
    for (const queueId of Object.keys(project.queues)) {
      const error = visit(queueId, queueId, new Set());
      if (error !== undefined) return yield* error;
    }
  });
export * as Queue from "./Queue.ts";
