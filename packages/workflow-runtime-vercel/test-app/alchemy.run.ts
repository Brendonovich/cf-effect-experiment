import * as Alchemy from "alchemy";
import * as Command from "alchemy/Command";
import { localState } from "alchemy/State";
import { Effect, Layer } from "effect";

import { providers as vercelProviders, VercelProject } from "./VercelProject.ts";

export const providers = () => Layer.mergeAll(vercelProviders(), Command.providers());

export default Alchemy.Stack(
  "MacroGraphWorkflowVercelTest",
  {
    providers: providers(),
    state: localState(),
  },
  Effect.gen(function* () {
    const context = yield* Alchemy.AlchemyContext;
    if (context.dev) {
      const build = yield* Command.Build("Build", {
        command: "pnpm build",
        outdir: ".next",
        memo: false,
      });
      const port = process.env.WORKFLOW_TEST_PORT ?? "3097";
      const server = yield* Command.Dev("WorkflowSDK", {
        command: `pnpm exec next start --hostname 127.0.0.1 --port ${port}`,
        env: {
          // The output reference makes the server depend on the completed build.
          WORKFLOW_BUILD_DIR: build.outdir,
          WORKFLOW_TARGET_WORLD: "local",
          WORKFLOW_LOCAL_BASE_URL: `http://127.0.0.1:${port}`,
        },
      });
      return { url: server.url };
    }
    const stage = yield* Alchemy.Stage;
    const project = yield* VercelProject("Project", { name: `macrograph-workflow-test-${stage}` });
    return { url: project.url };
  }),
);
