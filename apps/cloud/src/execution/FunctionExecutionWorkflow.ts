import { Project } from "@macrograph/core";
import { Queues } from "@macrograph/execution";
import * as Executor from "@macrograph/execution/Executor";
import { ProjectExecutor } from "@macrograph/project-host";
import * as CloudflareRuntime from "@macrograph/workflow-runtime-cloudflare/Alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Cause, Effect, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import ProjectIngressDO from "../ingress/ProjectIngressDO.ts";
import { DeploymentObjectsBucket } from "../Storage.ts";
import * as ExecutorModules from "./ExecutorModules.ts";
import * as Protocol from "./FunctionQueueProtocol.ts";
import * as FunctionQueueTransport from "./FunctionQueueTransport.ts";
import * as FunctionQueueValues from "./FunctionQueueValues.ts";
import * as WorkflowRuntime from "./WorkflowRuntime.ts";

export default class FunctionExecutionWorkflow extends Cloudflare.Workflow<FunctionExecutionWorkflow>()(
  "FunctionExecutionWorkflow",
  Effect.gen(function* () {
    const resource = yield* DeploymentObjectsBucket;
    const queueProjects = yield* ProjectIngressDO;
    const snapshots = yield* Cloudflare.R2.ReadBucket(resource);
    return Effect.fnUntraced(function* (input: Protocol.Work) {
      return yield* Effect.gen(function* () {
        const project = yield* Cloudflare.Workflows.task(
          "function-project-v1",
          Effect.gen(function* () {
            const object = yield* snapshots.get(input.r2Key);
            if (object === null)
              return yield* Effect.die(`Project deployment ${input.r2Key} not found`);
            const json = yield* object.text();
            const value = yield* Effect.try({
              try: () => JSON.parse(json),
              catch: (error) => error,
            });
            return yield* Schema.decodeUnknownEffect(Project.Model)(value);
          }).pipe(Effect.orDie),
        );
        const enqueue = yield* FunctionQueueTransport.make(queueProjects, input, input.id, project);
        const engineClient = yield* WorkflowRuntime.make(project).pipe(
          Effect.provide(FetchHttpClient.layer),
        );
        const executionEnvironment = yield* CloudflareRuntime.makeExecutionEnvironment();
        const executor = yield* ProjectExecutor.make(project, {
          projectId: input.projectId,
          modules: ExecutorModules.registry,
          engineClient,
          executionEnvironment,
          queueInvocation: (invocation) =>
            enqueue({
              queueId: invocation.queueId,
              functionId: invocation.functionId,
              values: invocation.inputs,
              queueLineage: invocation.queueLineage,
              executionPath: invocation.key.executionPath,
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new Executor.NodeExecutionError({ nodeId: invocation.key.nodeId, cause }),
              ),
            ),
        });
        // Function graphs are invoked directly, not synthesized engine events or nested task bodies.
        const fn = project.functions[input.functionId];
        if (fn === undefined)
          return yield* Effect.die(
            "Queued function signature is unavailable in the deployment snapshot",
          );
        const decoded = yield* FunctionQueueValues.transform(
          fn.arguments,
          input.values,
          "decode",
          project.types,
        );
        const result = yield* executor
          .invokeFunction(input.functionId, decoded, {
            queueLineage: [...input.queueLineage, input.queueId],
            executionPath: input.executionPath,
            executionTraceId: input.id,
          })
          .pipe(Effect.provideService(Queues.Lineage, [...input.queueLineage, input.queueId]));
        const values = yield* FunctionQueueValues.transform(
          fn.returns,
          result,
          "encode",
          project.types,
        );
        return { ok: true, values } satisfies Protocol.Outcome;
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.succeed({
            ok: false,
            error: String(Cause.squash(cause)),
          } satisfies Protocol.Outcome),
        ),
      );
    });
  }),
) {}
