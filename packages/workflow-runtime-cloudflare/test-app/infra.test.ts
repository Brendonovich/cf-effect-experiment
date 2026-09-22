import { verify } from "@macrograph/workflow-runtime-test/verify";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Bun";
import { Effect } from "effect";

import stack from "./alchemy.run.ts";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  stage: "infra-test",
});
const deployed = beforeAll(deploy(stack), { timeout: 600_000 });
afterAll(destroy(stack), { timeout: 300_000 });
test(
  "deploys and operates real Cloudflare Workflows",
  Effect.gen(function* () {
    const { url } = yield* deployed;
    if (!url) return yield* Effect.die("Worker URL missing");
    yield* Effect.tryPromise(() => verify(url));
  }),
  { timeout: 360_000 },
);
