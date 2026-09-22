import { Project } from "@macrograph/core";
import { Executor, Queues } from "@macrograph/execution";
import { DataType } from "@macrograph/module/DataType";
import { Effect, Schema } from "effect";

/** Constructs one project-scoped executor and its in-memory queue scheduler. */
export const make = Effect.fnUntraced(function* (
  initialProject: Project.Model,
  options?: Executor.MakeOptions,
) {
  let executor: Executor.Service;
  const queues = yield* Queues.make(initialProject.queues, (functionId, inputs) =>
    Effect.gen(function* () {
      const queueLineage = yield* Queues.Lineage;
      const project = yield* executor.project;
      const fn = project.functions[functionId];
      const decoded = { ...inputs };
      for (const field of fn?.arguments ?? []) {
        if (Object.hasOwn(inputs, field.id))
          decoded[field.id] = yield* Schema.decodeUnknownEffect(
            DataType.JsonValueSchema(field.type, project.types),
          )(inputs[field.id]);
      }
      return yield* executor.invokeFunction(functionId, decoded, { queueLineage });
    }),
  );
  executor = yield* Executor.make(initialProject, {
    ...options,
    queueInvocation: (invocation) =>
      Effect.gen(function* () {
        const project = yield* executor.project;
        const fn = project.functions[invocation.functionId];
        const captured: Record<string, unknown> = { ...invocation.inputs };
        for (const field of fn?.arguments ?? []) {
          if (Object.hasOwn(invocation.inputs, field.id))
            captured[field.id] = yield* Schema.encodeUnknownEffect(
              DataType.JsonValueSchema(field.type, project.types),
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
