import { Started, Status, verify } from "@macrograph/workflow-runtime-test/verify";
import * as Command from "alchemy/Command";
import * as Test from "alchemy/Test/Bun";
import { Effect, Schema } from "effect";
import assert from "node:assert/strict";

import stack from "./alchemy.run.ts";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Command.providers(),
  stage: "infra-test",
  dev: true,
});
const deployed = beforeAll(deploy(stack), { timeout: 120_000 });
afterAll(destroy(stack), { timeout: 120_000 });
test(
  "operates SQLite-backed Effect Cluster and deduplicates execution",
  Effect.gen(function* () {
    const { url } = yield* deployed;
    if (!url) return yield* Effect.die("Cluster URL missing");
    yield* Effect.tryPromise(async () => {
      await verify(url);
      const executionId = crypto.randomUUID();
      const start = async () => {
        const response = await fetch(`${url}/runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ executionId, value: "durable" }),
        });
        assert.equal(response.status, 200);
        return Schema.decodeUnknownSync(Started)(await response.json());
      };
      const { id } = await start();
      for (let attempt = 0; ; attempt++) {
        const status = Schema.decodeUnknownSync(Status)(
          await (await fetch(`${url}/runs/${id}`)).json(),
        );
        if (status.status === "complete") break;
        assert.ok(attempt < 60, "Duplicate test timed out");
        await Bun.sleep(500);
      }
      const before = await (await fetch(`${url}/executions`)).json();
      assert.equal((await start()).id, id);
      await Bun.sleep(1_000);
      assert.deepEqual(await (await fetch(`${url}/executions`)).json(), before);
    });
  }),
  { timeout: 360_000 },
);
