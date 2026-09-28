import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { EffectClusterRuntime } from "@macrograph/workflow-runtime-effect-cluster";
import { input, makeModules, RunRequest } from "@macrograph/workflow-runtime-test/fixture";
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option, Schema } from "effect";
import { SingleRunner } from "effect/unstable/cluster";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";

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
    Layer.provide(NodeCrypto.layer),
  ),
);
const workflow = EffectClusterRuntime.GraphExecutionWorkflow;
await runtime.runPromise(Effect.void);

const server = createServer((request, response) => {
  void (async () => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (path === "/health") return json(200, { ok: true });
    if (path === "/executions")
      return json(200, {
        count: existsSync(journal)
          ? readFileSync(journal, "utf8").trim().split("\n").filter(Boolean).length
          : 0,
      });
    if (path === "/runs" && request.method === "POST") {
      const chunks: Array<Uint8Array> = [];
      for await (const chunk of request) chunks.push(chunk);
      const raw: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!Schema.is(RunRequest)(raw)) return json(400, null);
      const body = raw;
      const id = await runtime.runPromise(
        workflow.execute(input(body.executionId, body.value), { discard: true }),
      );
      return json(200, { id });
    }
    if (path.startsWith("/runs/") && request.method === "GET") {
      const result = await runtime.runPromise(workflow.poll(path.slice("/runs/".length)));
      if (Option.isNone(result)) return json(200, { status: "running" });
      if (result.value._tag === "Suspended") return json(200, { status: "suspended" });
      const exit = result.value.exit;
      return json(
        200,
        Exit.isSuccess(exit)
          ? { status: "complete", output: exit.value }
          : { status: "errored", error: Cause.pretty(exit.cause) },
      );
    }
    return json(404, null);
  })().catch((error: unknown) => {
    console.error(error);
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
});
await new Promise<void>((resolve) =>
  server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", resolve),
);
const address = server.address();
if (address === null || typeof address === "string") throw new Error("Server did not bind to TCP");
console.log(`http://127.0.0.1:${address.port}`);
let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  await runtime.dispose();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
