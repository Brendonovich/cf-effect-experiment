import { Project } from "@macrograph/core";
import { Executor, Queues } from "@macrograph/execution";
import { DataType } from "@macrograph/plugin/DataType";
import { Effect, Schema } from "effect";

/** A scheduler belongs to the host lifetime, not to an individual event or RPC caller. */
export const make = Effect.fnUntraced(function* (
  project: Project.Model,
  options?: Executor.MakeOptions,
) {
  let executor: Executor.Service;
  const queues = yield* Queues.make(project.queues, (functionId, inputs) =>
    Effect.gen(function* () {
      const queueLineage = yield* Queues.Lineage;
      const project = yield* executor.project;
      const signature = project.graphs[functionId]?.signature;
      const decoded = { ...inputs };
      for (const field of signature?.inputs ?? []) {
        if (Object.hasOwn(inputs, field.id))
          decoded[field.id] = yield* Schema.decodeUnknownEffect(
            DataType.JsonValueSchema(field.type),
          )(inputs[field.id]);
      }
      return yield* executor.invokeFunction(functionId, decoded, { queueLineage });
    }),
  );
  executor = yield* Executor.make(project, {
    ...options,
    queueInvocation: (invocation) =>
      Effect.gen(function* () {
        const project = yield* executor.project;
        const signature = project.graphs[invocation.functionId]?.signature;
        const captured: Record<string, unknown> = { ...invocation.inputs };
        for (const field of signature?.inputs ?? []) {
          if (Object.hasOwn(invocation.inputs, field.id))
            captured[field.id] = yield* Schema.encodeUnknownEffect(
              DataType.JsonValueSchema(field.type),
            )(invocation.inputs[field.id]);
        }
        return yield* queues.enqueue(invocation.queueId, invocation.functionId, captured);
      }).pipe(
        Effect.provideService(Queues.Lineage, invocation.queueLineage),
        Effect.mapError(
          (cause) => new Executor.NodeExecutionError({ nodeId: invocation.key.nodeId, cause }),
        ),
      ),
  });
  const service: Executor.Service = {
    ...executor,
    loadProject: (project) =>
      executor.loadProject(project).pipe(Effect.andThen(queues.configure(project.queues))),
  };
  return { executor: service, queues };
});

export * as ProjectQueues from "./ProjectQueues.ts";
