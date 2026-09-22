import { GraphExecution } from "@macrograph/workflow-runtime";
import * as Runtime from "@macrograph/workflow-runtime-cloudflare/Alchemy";
import { input, modules } from "@macrograph/workflow-runtime-test/fixture";
import * as Cloudflare from "alchemy/Cloudflare";
import { Cause, Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

class TestWorkflow extends Cloudflare.Workflow<TestWorkflow>()(
  "TestWorkflow",
  Effect.succeed(
    Effect.fnUntraced(function* (payload: ReturnType<typeof input>) {
      const executionEnvironment = yield* Runtime.makeExecutionEnvironment({
        stepConfig: {
          retries: { limit: 0, delay: "1 second", backoff: "constant" },
          timeout: "30 seconds",
        },
      });
      yield* GraphExecution.run(payload.project, payload, { modules, executionEnvironment }).pipe(
        Effect.orDie,
      );
      return { executionId: payload.executionId, projectId: payload.projectId };
    }),
  ),
) {}

export default class WorkflowTest extends Cloudflare.Worker<WorkflowTest>()(
  "WorkflowTest",
  { main: import.meta.url },
  Effect.gen(function* () {
    const workflow = yield* TestWorkflow;
    return {
      fetch: Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const path = new URL(request.url, "http://localhost").pathname;
        if (path === "/health") return yield* HttpServerResponse.json({ ok: true });
        if (path === "/runs" && request.method === "POST") {
          const body = yield* request.json;
          if (
            typeof body !== "object" ||
            body === null ||
            !("executionId" in body) ||
            typeof body.executionId !== "string" ||
            !("value" in body) ||
            typeof body.value !== "string"
          ) {
            return HttpServerResponse.empty({ status: 400 });
          }
          const instance = yield* workflow.create({
            id: body.executionId,
            params: input(body.executionId, body.value),
          });
          return yield* HttpServerResponse.json({ id: instance.id });
        }
        if (path.startsWith("/runs/") && request.method === "GET") {
          const instance = yield* workflow.get(path.slice("/runs/".length));
          return yield* HttpServerResponse.json(yield* instance.status());
        }
        return HttpServerResponse.empty({ status: 404 });
      }).pipe(
        Effect.catchCause((cause) =>
          HttpServerResponse.json({ error: Cause.pretty(cause) }, { status: 500 }),
        ),
        Effect.orDie,
      ),
    };
  }),
) {}
