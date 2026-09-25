import { Effect, Schema, SchemaGetter } from "effect";

import type { Model as NodeModel } from "./Node.ts";
import type { Model as PackageModel } from "./Package.ts";

import { Function as GraphFunction } from "./Function.ts";
import { PackageId, SchemaId } from "./SchemaRef.ts";

export const QueueId = Schema.String.pipe(Schema.brand("QueueId"));
export type QueueId = typeof QueueId.Type;
export const Model = Schema.Struct({ id: QueueId, name: Schema.String });
export type Model = typeof Model.Type;
const CurrentCollection = Schema.Record(Schema.String, Model);
const StoredCollection = Schema.Record(
  Schema.String,
  Schema.Struct({
    id: QueueId,
    name: Schema.String,
    functionId: Schema.optional(Schema.String),
  }),
);
export const Collection = StoredCollection.pipe(
  Schema.decodeTo(CurrentCollection, {
    decode: SchemaGetter.transform((queues) =>
      Object.values(queues).some((queue) => queue.functionId !== undefined) ? {} : queues,
    ),
    encode: SchemaGetter.transform((queues) =>
      Object.fromEntries(
        Object.entries(queues).map(([id, queue]) => [
          id,
          { id: QueueId.make(queue.id), name: queue.name },
        ]),
      ),
    ),
  }),
  Schema.withDecodingDefaultKey(Effect.succeed({})),
);
export const Item = Schema.Struct({ id: Schema.String, functionId: Schema.String });
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
export const enqueueIO = (fn: GraphFunction.Model | undefined) => GraphFunction.callIO(fn);
export const packageModel: PackageModel = {
  id: packageId,
  name: "Queues",
  resources: [],
  schemas: [
    {
      id: EnqueueSchemaId,
      name: "Add to Queue",
      type: "exec",
      properties: [
        { id: "queue", name: "Queue", type: { _tag: "String" }, optional: true },
        { id: "function", name: "Function", function: true, optional: true },
      ],
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

export const validateProject = (
  project: ProjectQueues,
): Effect.Effect<void, RecursiveEnqueueError> =>
  Effect.gen(function* () {
    const functionsByQueue = new Map<string, Set<string>>();
    for (const fn of Object.values(project.functions))
      for (const node of Object.values(fn.canvas.nodes)) {
        if (!isEnqueue(node)) continue;
        const queueId = node.properties.queue;
        const functionId = node.properties.function;
        if (
          typeof queueId !== "string" ||
          typeof functionId !== "string" ||
          project.queues[queueId] === undefined ||
          project.functions[functionId] === undefined
        )
          continue;
        const functions = functionsByQueue.get(queueId) ?? new Set<string>();
        functions.add(functionId);
        functionsByQueue.set(queueId, functions);
      }
    const targets = (queueId: string): ReadonlyArray<string> =>
      Array.from(functionsByQueue.get(queueId) ?? []).flatMap((functionId) =>
        Object.values(project.functions[functionId]?.canvas.nodes ?? {}).flatMap((node) => {
          const target = node.properties.queue;
          return isEnqueue(node) && typeof target === "string" ? [target] : [];
        }),
      );
    const visit = (
      origin: string,
      current: string,
      visited: ReadonlySet<string>,
    ): RecursiveEnqueueError | undefined => {
      if (visited.has(current)) return undefined;
      if (project.queues[current] === undefined) return undefined;
      for (const target of targets(current)) {
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
