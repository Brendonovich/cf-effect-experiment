import { verify } from "@macrograph/workflow-runtime-test/verify";
import * as Test from "alchemy/Test/Bun";
import { Effect } from "effect";

import stack, { providers } from "./alchemy.run.ts";

const local = process.env.WORKFLOW_INFRA_LOCAL === "1";

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: providers(),
  stage: local ? "local-test" : "infra-test",
  dev: local,
});
const deployed = beforeAll(deploy(stack), { timeout: 900_000 });
afterAll(destroy(stack), { timeout: 300_000 });
test(
  local ? "operates compiled Workflow SDK locally" : "deploys and operates Vercel Workflow SDK",
  Effect.gen(function* () {
    const { url } = yield* deployed;
    if (!url) return yield* Effect.die("Workflow SDK app URL missing");
    yield* Effect.tryPromise(() =>
      verify(
        url,
        process.env.VERCEL_AUTOMATION_BYPASS_SECRET
          ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
          : {},
      ),
    );
  }),
  { timeout: 360_000 },
);
