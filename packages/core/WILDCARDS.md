# Wildcards

Schemas declare node-local type variables with `io.wildcard(id)` (or
`DataType.Wildcard(id)`). Reusing an ID on multiple pins ties their types together.
The same ID on a different node is independent until wires constrain it.

```ts
io: (io) => {
  const item = io.wildcard("Item");
  return {
    list: io.data.in("list", DataType.List(item)),
    value: io.data.in("value", item),
    output: io.data.out("output", DataType.List(item)),
  };
},
run: ({ io }) => Effect.sync(() => io.output([...io.list, io.value])),
```

Wildcard runtime values are `unknown`. An unconstrained wildcard is **not** an
"any" type: execution rejects unresolved IO before running node effects. Concrete
inferred types validate inputs, defaults, outputs, scope payloads, and durable
result serialization just like explicitly declared types.

Shipped List, generic Logic/Option, Cache/Copy, and JSON conversion nodes use these
wildcards instead of Type/List properties. Counts and other behavior properties
remain. Generic value inputs have no arbitrary scalar default; List/Option inputs
can still default to `[]`/None once their item type is inferred.

`DataType.JsonDefaultSchema` serializes these empty container defaults in schema
declarations before inference. It cannot encode a value in an unresolved wildcard
slot; runtime values still use the stricter, fully resolved `JsonValueSchema`.

Type-dependent schema implementations can use `run({ io, types })`:
`types.resolve(DataType.Wildcard("T"))` reads the node's resolved type, and
`types.definitions` supplies project custom definitions for JSON/value codecs.
The executor supplies this context; direct low-level schema runners must supply
`types` when running schemas that inspect it.

## Resolution

`Wildcards.Cache` is an ordinary, non-reactive object:

- `update(declarations, connections)` returns an Effect `Result`. It stages the
  changed groups and validates them before committing. A failure returns transient
  connection diagnostics; the previous groups, bindings and indexes stay untouched.
  Only successfully validated groups enter the cache.
- Each group retains its direct `connections` alongside its `nodes` and type
  resolver. A persistent per-node incident-wire index is updated copy-on-write for
  changed wires, so crawling affected groups does not rebuild graph-wide adjacency.
  Unchanged groups and their cached wildcard values are reused.
- Groups conservatively contain all pins on their member nodes, connected through
  data or bundled scope wires. Plain execution wires do not couple groups. Distinct
  wildcard IDs still have distinct unification variables within each group.
- Unification supports whole-type wildcards and wildcards nested in `List` and
  `Option`, in either connection direction. Custom types remain nominal by ID.
- An occurs check rejects infinite types such as `T = List<T>`. Conflicting
  concrete anchors reject a proposed connection/paste. Errors are returned to the
  caller, never stored on groups. For invalid saved graphs, readers use declarations
  rather than stale inference; execution reports an error if it reaches an invalid
  component, while independently valid components can still execute.
- Removing a wire/node or changing IO re-solves affected groups from declarations,
  never from yesterday's inferred types. Alternate concrete anchors remain valid;
  removing the last anchor restores an unresolved wildcard, including in cycles.
- `resolve(nodeId, type)` / `resolveIO(nodeId, io)` provide inferred types without
  mutating the declaration. `groups` / `group(nodeId)` expose only completed groups
  and their direct connections. Callers must check `update` before using inference
  for a new graph snapshot.

Break Struct also derives its output declarations from its input wildcard. The cache
accepts a keyed output-derivation callback, stages inference and field generation until
stable, and only commits the completed result. It starts without previous inferred fields
to prevent stale Break chains from anchoring themselves after disconnection.
`derivedOutputs(nodeId)` returns the completed output declarations. Unchanged snapshots
reuse the completed cache without recalculating fields.

## Integration and storage

The editor caches per graph and synchronizes against current/proposed declarations
when validating or rendering. Snapshots and IO events carry **declarations**, not
resolved IO. The client store keeps `declaredNodeIO` separately from its public
resolved `nodeIO`; event reducers explicitly update the cache. No reactive effect
or memo discovers wildcard connections.

The executor builds event-local caches from the immutable project snapshot, then
shares their inferred types between preflight and execution. No live resource
lookup or schema execution occurs during wildcard inference. Missing schemas
outside the execution closure retain the executor's existing repairability rules.

Inferred types are not stored in project files. A snapshot reload, undo/replay, or
paste recomputes them. Defaults on detached pasted wildcard nodes are retained for
reconnection; once resolved they must match the inferred type. Wildcards cannot
appear in project-wide struct/enum definitions, which do not have node-local scope.
