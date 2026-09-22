import * as BunCrypto from "@effect/platform-bun/BunCrypto";
import * as SqliteClient from "@effect/sql-sqlite-bun/SqliteClient";
import { EffectClusterRuntime } from "@macrograph/workflow-runtime-effect-cluster";
import { input, makeModules, RunRequest } from "@macrograph/workflow-runtime-test/fixture";
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Schema } from "effect";
import { SingleRunner } from "effect/unstable/cluster";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";

mkdirSync(".alchemy", { recursive: true });
const journal = ".alchemy/executions.jsonl";
const modules = makeModules((value) =>
  Effect.sync(() => {
    appendFileSync(journal, `${JSON.stringify({ value })}\n`);
  }),
);
const runtime = ManagedRuntime.make(
  EffectClusterRuntime.runtimeLayer({ modules }).pipe(
    Layer.provide(SingleRunner.layer({ runnerStorage: "memory" })),
    Layer.provide(SqliteClient.layer({ filename: ".alchemy/cluster.sqlite" })),
    Layer.provide(BunCrypto.layer),
  ),
);
const workflow = EffectClusterRuntime.GraphExecutionWorkflow;
await runtime.runPromise(Effect.void);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 0),
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/health") return Response.json({ ok: true });
    if (path === "/executions")
      return Response.json({
        count: existsSync(journal)
          ? readFileSync(journal, "utf8").trim().split("\n").filter(Boolean).length
          : 0,
      });
    if (path === "/runs" && request.method === "POST") {
      const raw = await request.json();
      if (!Schema.is(RunRequest)(raw)) return new Response(null, { status: 400 });
      const body = raw;
      const id = await runtime.runPromise(
        workflow.execute(input(body.executionId, body.value), { discard: true }),
      );
      return Response.json({ id });
    }
    if (path.startsWith("/runs/") && request.method === "GET") {
      const result = await runtime.runPromise(workflow.poll(path.slice("/runs/".length)));
      if (Option.isNone(result)) return Response.json({ status: "running" });
      if (result.value._tag === "Suspended") return Response.json({ status: "suspended" });
      const exit = result.value.exit;
      return Response.json(
        Exit.isSuccess(exit)
          ? { status: "complete", output: exit.value }
          : { status: "errored", error: Cause.pretty(exit.cause) },
      );
    }
    return new Response(null, { status: 404 });
  },
});
console.log(`http://127.0.0.1:${server.port}`);
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await server.stop(true);
  await runtime.dispose();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
