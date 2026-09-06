# Scope ports

A scope is an execution port carrying a named, typed payload on the same wire.
It is not a data value, and cannot connect to ordinary exec or data inputs.

`Match Enum` emits a scope for each variant with fields. Empty variants still emit
ordinary exec. Right-click a scope output and choose **Split scope**: its branch
label becomes an exec pin and its fields appear underneath, inside a left rail
with top/bottom caps. No extra node is created. Right-click the group to bundle it
again. Mode changes are blocked while that scope has output wires, so no connected
pins disappear. The existing **Scopes → Break Scope** node also remains available
as an explicit consumer of a bundled scope.

The editor lays inputs and outputs out in independent columns, one row per pin.
Each expanded scope is a bordered wrapper around its output rows; its padding and
height do not move pins in the input column.

## Graph model

`Node.splitScopeOutputs` stores the optional list of expanded scope IDs. It is
presentation state, shared with collaborators and preserved by copy/paste and
persistence. Fields and types are always derived from the source declaration.

Connections store `outNodeId` and a structured `outIo` reference:

```ts
{ _tag: "Port", id: "found" }                         // whole scope
{ _tag: "ScopeExec", scope: "found" }                  // execution projection
{ _tag: "ScopeField", scope: "found", field: "value" } // typed field projection
```

Input endpoints still use `inNodeId` and `inIoId`. Output references are resolved
against declarations independently of display mode. `OutputRef.key` produces a
collision-free UI/cache key; these keys are not port IDs or stored wire references.
Connected projections remain visible even if a headless client creates them while
the scope is bundled. Incompatible wires follow normal repair/removal rules.

## Runtime lifetime

After validating a selected scope payload, execution creates a branch-local
activation keyed by its source node and scope. `ScopeExec` routes ordinary exec;
`ScopeField` reads the matching active payload. Nested branches inherit outer
activations. Sibling paths never receive activations created in another sibling.
Reading an inactive scope raises `ScopeNotActive`: it neither reuses a previous
payload nor runs the source node on demand. Pure dependencies resolve in the
consuming execution's scope context, with their cache reset between exec steps.

Splitting creates no hidden nodes, additional runtime steps, or checkpoints.
Replay restores the source's validated result and recreates the same activation.

## Module API

```ts
yield* context.schema.register({
  id: "Example",
  type: "base",
  io: (io) => ({
    input: io.exec.in("exec"),
    found: io.scope.out("found", { value: DataType.String }),
    missing: io.exec.out("missing"),
  }),
  run: ({ io }) => Effect.succeed(io.found({ value: "hello" })),
});
```

The materialized scope output is a typed function returning the selected branch
and payload atomically. Return that result from `run`; merely calling it does not
select the branch. `io.scope.in("input", { value: DataType.String })` declares a typed
scope consumer, materialized as `{ value: string }`. Use `type: "base"` when defining
explicit execution inputs/outputs rather than the implicit `exec` ports.

Internally, scope ports share execution routing and cycle checks. An execution
port's `scope` is absent for ordinary exec, an array of field descriptors for a
typed scope, or `null` for Break Scope's inferred input. Fields match by ID and
type (including nominal custom-type identity), independently of labels and order.

Execution results carry `scopePayload` alongside `executionOutputId`. Every field
must be present, no extra fields are accepted, and field values are encoded and
decoded through current project codecs at the execution-driver boundary. Payloads
are delivered only along the selected scope wire, including when replayed.
