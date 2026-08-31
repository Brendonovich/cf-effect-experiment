import { assert, describe, it } from "@effect/vitest";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Exit } from "effect";

import type { ProjectIngressShape } from "../src/ingress/ProjectIngressDO.ts";

import { DeploymentObjectKey } from "../src/deployment/DeploymentObjectKey.ts";
import * as Transport from "../src/execution/FunctionQueueTransport.ts";

describe("Workflow queue awaiting", () => {
  it.effect("uses separate durable RPC/status/sleep steps, then returns Workflow output", () =>
    Effect.gen(function* () {
      let executingTask = false;
      let polls = 0;
      const names: string[] = [];
      const step: Cloudflare.Workflows.WorkflowStep["Service"] = {
        do: (options) =>
          Effect.gen(function* () {
            assert.isFalse(executingTask, "durable steps must never be nested");
            executingTask = true;
            names.push(options.name);
            return yield* options.effect.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  executingTask = false;
                }),
              ),
            );
          }),
        sleep: (name) =>
          Effect.sync(() => {
            assert.isFalse(executingTask);
            names.push(name);
          }),
        sleepUntil: () => Effect.void,
        waitForEvent: () => Effect.die("unexpected event wait"),
      };
      const projects = {
        getByName: () => ({
          queueEnqueue: () => Effect.void,
          queueInspect: () => Effect.succeed({ state: "running" }),
        }),
      } as unknown as Cloudflare.DurableObject<ProjectIngressShape>;
      const enqueue = yield* Transport.make(
        projects,
        {
          projectId: "project",
          deploymentId: "deployment",
          r2Key: DeploymentObjectKey.make("snapshot"),
        },
        "parent",
      ).pipe(
        Effect.provideService(Cloudflare.Workflows.WorkflowStep, step),
        Effect.provideService(Cloudflare.WorkerEnvironment, {
          FunctionExecutionWorkflow: {
            create: async () => undefined,
            get: async () => ({
              status: async () =>
                ++polls < 2
                  ? { status: "running" }
                  : { status: "complete", output: { ok: true, values: { answer: 42 } } },
            }),
          },
        }),
      );
      const result = yield* enqueue({
        queueId: "queue",
        functionId: "function",
        values: {},
        queueLineage: [],
        executionPath: "path",
      });
      assert.deepStrictEqual(result, { answer: 42 });
      assert.deepStrictEqual(
        names.map((name) => name.split("/").slice(2).join("/")),
        ["enqueue", "status/0", "wait/0", "status/1"],
      );
    }),
  );

  it.effect("a removed pending item fails its awaiting parent instead of hanging", () =>
    Effect.gen(function* () {
      const step: Cloudflare.Workflows.WorkflowStep["Service"] = {
        do: (options) => options.effect,
        sleep: () => Effect.die("removed work must not sleep"),
        sleepUntil: () => Effect.void,
        waitForEvent: () => Effect.die("unexpected event wait"),
      };
      const projects = {
        getByName: () => ({
          queueEnqueue: () => Effect.void,
          queueInspect: () => Effect.succeed({ state: "absent" }),
        }),
      } as unknown as Cloudflare.DurableObject<ProjectIngressShape>;
      const enqueue = yield* Transport.make(
        projects,
        {
          projectId: "project",
          deploymentId: "deployment",
          r2Key: DeploymentObjectKey.make("snapshot"),
        },
        "parent",
      ).pipe(
        Effect.provideService(Cloudflare.Workflows.WorkflowStep, step),
        Effect.provideService(Cloudflare.WorkerEnvironment, {
          FunctionExecutionWorkflow: {
            create: async () => undefined,
            get: async () => {
              throw new Error("not found");
            },
          },
        }),
      );
      assert.isTrue(
        Exit.isFailure(
          yield* Effect.exit(
            enqueue({
              queueId: "queue",
              functionId: "function",
              values: {},
              queueLineage: [],
              executionPath: "path",
            }),
          ),
        ),
      );
    }),
  );
});
