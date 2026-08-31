# Cloud Function Queues

The existing `ProjectIngressDO`, addressed by project ID, owns FIFO start
admission. Its `function-queue-scheduling` storage contains queue pause state
and live scheduling entries with captured arguments, immutable deployment R2
identity, lineage, and dispatch retry metadata. Completed outputs are never
stored in the DO. The Workflow owns execution durability and its final output.

`FunctionWorkQueue` is a real `Cloudflare.Queues.Queue`. The ingress worker
registers `WriteQueueBinding` and `consumeQueueMessages` with `EventSourceLive`;
Alchemy automatically provisions the consumer. Queue deliveries contain only
`{ projectId, deploymentId, r2Key, queueId, id }`. The consumer asks the DO to
create the stable-ID `FunctionExecutionWorkflow`. Reordered or duplicate
deliveries cannot admit waiting work. Consumer concurrency does not determine
function concurrency.

## Runtime Contract

`FunctionQueueProtocol.Scope` is `{ projectId, deploymentId, r2Key }`.
Scheduling is isolated by project and deployment; work retains its captured
snapshot when a new deployment is activated.

`ProjectIngressDO` exposes:

- `queueEnqueue(work)` captures work and admits the FIFO head.
- `queueDeliver(delivery)` idempotently creates an admitted Workflow.
- `queueInspect(delivery)` returns live scheduling phase, an actionable failure,
  or `absent`; it never returns function outputs.
- `queueSnapshot(scope)` returns `{ queueId, paused, waiting, running }[]`.
- `queuePause(scope, queueId, paused)` does not interrupt running functions.
- `queueAdvance(scope, queueId)` admits one additional waiting function. An
  unconfirmed previous dispatch must finish first to preserve FIFO starts.
- `queueRemove(scope, queueId, id)` and `queueClear(scope, queueId)` remove
  pending work and request termination of running Workflows.

Automatic starts resume only when all overlapping Workflows finish. The DO
alarm retries transport and reconciles terminal Workflow status. Dispatch
failures are bounded; an exhausted entry is removed so later work continues.
Parents observe live errors, removed work, or terminal Workflow failures and
fail rather than retaining an unresolved in-memory Deferred.

`FunctionQueueTransport.make(projects, scope, parentId, deployment)` returns an enqueue
callback accepting `{ queueId, functionId, values, queueLineage, executionPath }`.
It hashes project/deployment/parent/path into a stable Workflow ID. Its own
durable admission and status steps plus durable sleeps must run **outside** a
node's durable task. It reads final Workflow output as
`{ ok: true, values } | { ok: false, error }`.

Signature fields use `DataType.JsonValueSchema` at all four queue boundaries:
parent input encoding, child input decoding, child output encoding, and parent
output decoding. Runtime DateTime and recursive Option/List values must never
be structured-cloned before this encoding.

## Function Integration

Cloud hooks target function commit `19466cccfe7e07387dc6800173dd82b301837c29`:

- `Executor.MakeOptions.queueInvocation({ key, functionId, inputs, queueId,
  queueLineage })` executes outside node tasks.
- `Executor.Service.invokeFunction(graphId, inputs, { executionPath,
  queueLineage, executionTraceId })` directly runs the function graph.
- Cloud invocation maps `inputs` to transport `values` and uses
  `key.executionPath` for stable work identity.

No synthetic engine events, new Durable Object class, result journal, remote
deployment, or root dependency changes are required. Editor-facing production
queue controls forward through the existing ingress worker binding.
`ProjectEditorDO` provides `QueueRuntime.Service` before constructing the RPC
handlers, preserving their existing read/write authorization. Each operation
resolves the current database deployment through `loadDesiredDeployment`; the state stream polls every two
seconds and suppresses unchanged snapshots. Preview/local queue controls
remain owned by the project runtime implementation.

## Operational Limits

Cloud deployment and live consumer/Workflow execution have not been verified by
these unit tests. Stable completed-call deduplication relies on Workflow retention.
Five-second durable status polling consumes Workflow steps during long waits.

A running Workflow whose status API is unavailable is not treated as complete:
automatic dispatch waits for recovery or explicit cancellation. Cancellation
releases an unconfirmed remote start after five failed/unknown status checks so
later calls can continue. Termination is attempted, but a prolonged provider
outage can leave orphaned remote work and unintended overlap. No successful result
is fabricated. This liveness-versus-confirmed-termination tradeoff needs live
Cloudflare review before promotion from draft.

Production runtime controls operate on the active deployment, not un-deployed
editor metadata. Publish queue definition changes to update cloud scheduling.

## Verification

Run from this directory:

```sh
pnpm exec vp test run test/*.test.ts
```

Run `pnpm typecheck` at the repository root after integrating the function
commit. Unit tests use fake Queue/Workflow bindings and do not deploy resources.
