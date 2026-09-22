# `@macrograph/workflow-runtime-cloudflare`

Cloudflare Workflows execution of MacroGraph nodes. The application owns its
module registry, engine clients, deployment snapshots, and execution database.

## Runtime (no Alchemy dependency)

```ts
import { CloudflareRuntime } from "@macrograph/workflow-runtime-cloudflare";
import { GraphExecution } from "@macrograph/workflow-runtime";
import { Effect } from "effect";

// Inside a native WorkflowEntrypoint.run(event, step):
const executionEnvironment = CloudflareRuntime.makeExecutionEnvironment(
  CloudflareRuntime.makeTask(step),
);
await Effect.runPromise(GraphExecution.run(project, input, { modules, executionEnvironment }));
```

Each node uses the shared, versioned `ExecutionStep.nodeStepName`. Optional
`decorateNode` adds app-specific tracing inside the durable step. Optional
`onNodeState` persists running/complete/errored transitions in separate durable
steps. Failures are rethrown after the error transition is recorded.

## Alchemy

```ts
import * as Runtime from "@macrograph/workflow-runtime-cloudflare/Alchemy";
import { GraphExecution } from "@macrograph/workflow-runtime";
import { Effect } from "effect";

const run = Effect.gen(function* () {
  const executionEnvironment = yield* Runtime.makeExecutionEnvironment();
  yield* GraphExecution.run(project, input, { modules, executionEnvironment });
});
```

This entry point captures Alchemy's invocation-local `WorkflowStep` service and
adapts `Cloudflare.Workflows.task`. It is deliberately separate from the root
export so native Workers can use the package without loading Alchemy.

Supply a complete `stepConfig` (retry limit, delay, backoff, and timeout) to
override Cloudflare's defaults. Alchemy forwards config fields verbatim, so
partial overrides can send undefined durations to the native API. The test app
disables retries for its deliberately failing node so terminal failure can be
asserted promptly; the cloud application keeps Cloudflare's default policy.

`apps/cloud/src/execution/GraphExecutionWorkflow.ts` supplies the application
database transitions and tracing. Its deployment loading, event records,
module catalog, and snapshot-backed engine clients remain application concerns.

## Real infrastructure test

See [`../workflow-runtime/test-app/README.md`](../workflow-runtime/test-app/README.md).
