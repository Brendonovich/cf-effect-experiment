# `@macrograph/workflow-runtime-effect-cluster`

Executes MacroGraph nodes as Effect Workflow activities using the Cluster
workflow engine. Applications supply their module registry and engine clients,
then provide a Cluster runner to `EffectClusterRuntime.runtimeLayer`.

`test-app/` runs a real SQLite-backed `SingleRunner`, managed locally by Alchemy,
and tests HTTP submission, completion, failure, and idempotent execution.
See [infrastructure test instructions](../workflow-runtime/test-app/README.md).
