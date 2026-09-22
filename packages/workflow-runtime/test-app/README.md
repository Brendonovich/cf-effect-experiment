# Workflow infrastructure test apps

These private workspace apps exercise the actual runtime adapters through HTTP:
submit a graph event, poll its durable run, validate completion and the returned
execution identity, re-read the persisted result, and exercise a failing node.
They are opt-in and are excluded from normal Vitest runs.

The shared module in `fixture.ts` validates the event and emits a data output
from a non-pure graph node. A second input deliberately fails inside that node.
Each app uses its package's runtime adapter, rather than a standalone toy
workflow unrelated to MacroGraph.

## Commands

Run from the repository root after `pnpm install`. Bun is required for Alchemy.

```sh
pnpm --filter @macrograph/workflow-runtime-cloudflare test:infra
pnpm --filter @macrograph/workflow-runtime-vercel test:infra
pnpm --filter @macrograph/workflow-runtime-effect-cluster test:infra
```

### Cloudflare

Uses Alchemy's Cloudflare provider to deploy an isolated Worker and a real
Cloudflare Workflow. Authenticate Alchemy's Cloudflare profile first, or supply
the Cloudflare credentials supported by Alchemy. The stack is
`MacroGraphWorkflowCloudflareTest`, stage `infra-test`.

### Vercel

Uses the Workflow SDK's `use workflow` / `use step` compilation through
`withWorkflow` in a Next.js route-only app. Set `VERCEL_TOKEN` and
`VERCEL_ORG_ID` (the team ID) in the environment or test app's `.env`.

Alchemy v2 currently has no Vercel provider. `VercelProject.ts` is a test-owned
Alchemy resource: it creates a disposable Next.js project through the Vercel
API, deploys the monorepo with the Vercel CLI, and deletes the project (including
its deployments) during teardown. No existing Vercel project is reused.
Deployment protection is disabled on this disposable project; if team policy
enforces protection, set `VERCEL_AUTOMATION_BYPASS_SECRET` too.

The stack is `MacroGraphWorkflowVercelTest`, stage `infra-test`. Its temporary
project is `macrograph-workflow-test-infra-test`.

To check the compiled Workflow SDK artifact without Vercel credentials, run
`pnpm --filter @macrograph/workflow-runtime-vercel test:infra:local`. Alchemy builds
the Next app and manages `next start` with the SDK's local world. This is a
separate check from deployment to Vercel. Override `WORKFLOW_TEST_PORT` if the
default loopback port 3097 is in use.

### Effect Cluster

Runs a real SQL-backed `SingleRunner` locally, with Bun SQLite message storage
at `packages/workflow-runtime-effect-cluster/test-app/.alchemy/cluster.sqlite`.
Alchemy manages the server using `Command.Dev`; no cloud account is required.
The test also submits an already-completed execution again and verifies that
the node's append-only side-effect journal does not grow.

For interactive use:

```sh
pnpm --filter @macrograph/workflow-runtime-effect-cluster-test-app dev
```

## Evidence and cleanup

Each app writes `.alchemy/evidence/runs.json` in its own directory, including
the endpoint, submitted execution IDs, and observed statuses. Deployment
failures fail the test; missing credentials are not treated as skipped passes.
Alchemy test hooks tear down deployed resources even when assertions fail.
Local SQLite and evidence files are retained for inspection.

After an interrupted cloud test, run the matching app's destroy command from
the same directory, with the same credentials and stage:

```sh
pnpm --filter @macrograph/workflow-runtime-cloudflare-test-app alchemy destroy --stage infra-test
pnpm --filter @macrograph/workflow-runtime-vercel-test-app alchemy destroy --stage infra-test
```

Alchemy state is local to each app's `.alchemy/state`; retain it until teardown
has succeeded. Use distinct stages/project names for concurrent deployments.
