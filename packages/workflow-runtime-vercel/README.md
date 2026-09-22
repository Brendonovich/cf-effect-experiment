# `@macrograph/workflow-runtime-vercel`

The Vercel app owns its module catalog and engine clients. Its workflow file supplies the Workflow SDK directives and delegates the serializable work to this package:

```ts
async function executeNode(input: VercelRuntime.NodeStepInput) {
  "use step";
  return VercelRuntime.runNodeStep(input, { modules, makeEngineClient });
}

export async function executeGraph(input: VercelRuntime.ExecutionInput) {
  "use workflow";
  return VercelRuntime.runWorkflow(input, { modules, executeNode });
}
```

Each non-pure graph node crosses the workflow boundary as a serializable `NodeExecution.Request`. Pure nodes and graph traversal remain in the workflow invocation.

`test-app/` contains a deployable Next.js / Workflow SDK app and an Alchemy-managed
Vercel infrastructure test. See [infrastructure test instructions](../workflow-runtime/test-app/README.md).
