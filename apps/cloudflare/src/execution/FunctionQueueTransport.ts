import { Queue } from "@macrograph/core";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema, Stream } from "effect";

import ProjectIngressDO, { type ProjectIngressShape } from "../ingress/ProjectIngressDO.ts";
import * as Protocol from "./FunctionQueueProtocol.ts";

export const consume = (resource: Cloudflare.Queues.Queue) =>
  Effect.gen(function* () {
    const projects = yield* ProjectIngressDO;
    yield* Cloudflare.Queues.consumeQueueMessages(
      resource,
      {
        batchSize: 10,
        maxRetries: 5,
        retryDelay: "5 seconds",
      },
      (messages) =>
        Stream.runForEach(messages, (message) =>
          Schema.decodeUnknownEffect(Protocol.Delivery)(message.body).pipe(
            Effect.flatMap((delivery) =>
              projects.getByName(delivery.projectId).queueDeliver(delivery),
            ),
          ),
        ),
    );
  });

export interface EnqueueRequest {
  readonly queueId: string;
  readonly functionId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly queueLineage: ReadonlyArray<string>;
  readonly executionPath: string;
}

// Called outside executeNode's durable task. Every RPC/status read has its own durable step.
export const make = Effect.fnUntraced(function* (
  projects: Cloudflare.DurableObject<ProjectIngressShape>,
  scope: Protocol.Scope,
  parentId: string,
) {
  const environment = yield* Cloudflare.WorkerEnvironment;
  const workflowStep = yield* Cloudflare.Workflows.WorkflowStep;
  const project = projects.getByName(scope.projectId);
  return (request: EnqueueRequest) =>
    Effect.gen(function* () {
      if (request.queueLineage.includes(request.queueId))
        return yield* new Queue.OperationError({
          queueId: request.queueId,
          reason: "Awaited enqueue would create a queue lineage cycle",
        });
      const id = yield* Effect.promise(() =>
        Protocol.workId(scope, parentId, request.executionPath),
      );
      const work: Protocol.Work = { ...scope, ...request, id };
      const name = `function-queue-v1/${id}`;
      const admission = yield* Cloudflare.Workflows.task(
        `${name}/enqueue`,
        project.queueEnqueue(work).pipe(
          Effect.as({ ok: true as const }),
          Effect.catch((error) => Effect.succeed({ ok: false as const, error: String(error) })),
        ),
      );
      if (!admission.ok)
        return yield* new Queue.OperationError({
          queueId: request.queueId,
          reason: admission.error,
        });
      for (let attempt = 0; ; attempt++) {
        const result = yield* Cloudflare.Workflows.task(
          `${name}/status/${attempt}`,
          Effect.gen(function* () {
            const scheduling = yield* project.queueInspect(work);
            if ("error" in scheduling && scheduling.error !== undefined)
              return { ok: false, error: scheduling.error } satisfies Protocol.Outcome;
            const status = yield* Effect.tryPromise({
              try: async () =>
                (
                  await Protocol.workflowBinding(environment?.FunctionExecutionWorkflow).get(id)
                ).status(),
              catch: (error) => error,
            }).pipe(Effect.option);
            if (status._tag === "Some" && Protocol.terminal(status.value)) {
              if (status.value.status !== "complete")
                return {
                  ok: false,
                  error: status.value.error?.message ?? `Queued function ${status.value.status}`,
                } satisfies Protocol.Outcome;
              return yield* Schema.decodeUnknownEffect(Protocol.Outcome)(status.value.output).pipe(
                Effect.orDie,
              );
            }
            if (
              scheduling.state === "absent" &&
              (status._tag === "None" || status.value.status === "unknown")
            )
              return {
                ok: false,
                error: "Queue item removed or cleared",
              } satisfies Protocol.Outcome;
            return null;
          }).pipe(Effect.orDie),
        );
        if (result !== null) {
          if (!result.ok)
            return yield* new Queue.OperationError({
              queueId: request.queueId,
              reason: result.error,
            });
          return result.values;
        }
        yield* Cloudflare.Workflows.sleep(`${name}/wait/${attempt}`, "5 seconds");
      }
    }).pipe(Effect.provideService(Cloudflare.Workflows.WorkflowStep, workflowStep));
});
