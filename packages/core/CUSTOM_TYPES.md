# Custom Types

Projects carry a `types` registry keyed by stable definition identity. Old project files
decode with an empty registry. Struct fields and tagged enum payloads use the same
descriptors as pins: scalar types, DateTime, List, Option, and Custom references.

`DataType.Custom(DefinitionId.make(id))` refers to a project definition. Compatibility
compares identity recursively through containers, not structural equality. Runtime
objects include `_type` with the definition identity; enums additionally include `_tag`
with the variant name. These reserved markers survive JSON conversion and durable replay.

## Authoring And Changes

The Types panel authors named structs and tagged variants with a nested type picker.
`PreviewTypeDefinition` validates the proposal and reports transitive dependent types
and affected nodes across every graph, including IO, stored defaults, properties and wires.
`ConfirmTypeDefinition` consumes a short-lived opaque preview token under the editor lock.
Any intervening project or package-catalog change invalidates confirmation.

The confirmed policy is **preserve invalid**, not migration by deletion. Type edits and
deletions retain nodes, connections, defaults, and dependent definitions exactly as saved.
The `TypeDefinitionsUpdated` event persists the registry and distributes current IO to
collaborators. Removed schema/pin/default references remain visible with repair diagnostics.
Users explicitly repair defaults, remove obsolete connections/nodes, or restore definitions.
No older registry is retained to make invalid runtime data appear valid.

`TypeDefinition.validate` checks identities, names, reserved/duplicate fields and variants,
dangling references and finite recursion. Newly authored definitions must be valid; existing
dependent definitions can remain intentionally invalid after deletion, without preventing
unrelated authoring. Required recursive cycles must terminate through List, Option or an
enum variant. Recursive types describe finite values, not cyclic JavaScript object graphs.

## Operations And Values

The project-scoped `CustomTypes` built-in package shares IO generation between
editor and executor. Its catalog always contains seven operations: `MakeStruct`, `BreakStruct`,
`UpdateStruct`, `ConstructEnum`, `MatchEnum`, `ParseJson`, and `StringifyJson`. Except for
`BreakStruct`, each stores a stable definition ID in the `type` property; `ConstructEnum`
also stores a variant name in `variant`. Break Struct has no properties: its `value` input
is a wildcard constrained to structs. Connecting a struct reveals its fields, including
through chains of Break nodes. Disconnection clears inferred fields; stale wires remain
available for repair. Primitive, container and enum inputs are rejected.
Struct/Enum selectors filter by definition kind; JSON nodes accept either. Missing selections,
wrong kinds and removed variants produce diagnostics and block reachable execution.
Renaming a type does not break nodes. Fields and variants retain name-based identity;
renaming a member intentionally exposes old pins for repair. Old per-type schema IDs are not supported.

- Make and break structs. Update Struct exposes an `Option<FieldType>` input for every field,
  defaulting to `None` (keep the original); `Some(value)` replaces that field immutably. For an
  optional field, `Some(None)` clears it and `Some(Some(value))` sets it. Pin collapsing is separate.
- Construct each tagged variant; match chooses a scope branch carrying its typed payload.
  Split it inline to expose fields and execution, or connect it to Break Scope. Empty variants use
  ordinary exec outputs. See [Scope ports](./SCOPES.md).
- Parse and stringify JSON through current project codecs, retaining nominal markers.
- List operations accept custom and nested container types through wildcard connections.

Changing a custom node's type/variant property preserves saved defaults and connections for
explicit repair, even when the new selection makes them invalid.

Structured default controls edit scalars, dates, list entries, optional values and tagged payloads.
Recursive controls expand only finite saved/explicitly added values. Invalid saved content remains
visible and requires explicit replacement or removal.

Pass current project definitions to `ValueSchema`, `JsonValueSchema`, or `isValue`. Custom codecs
reject excess fields instead of silently stripping obsolete data. Unsafe registry entries fail
validation, and finite payload guards reject cycles, depth above 128, or more than 100000 entries.
JSON conversion handles Effect DateTime and Option wire formats, including nested values.

Execution preflight validates the event's reachable execution/data dependency graph before side
effects, including stale IO, defaults, nominal connections and transitive definition dependencies.
Unused invalid definitions and unrelated graphs do not block valid execution. Durable driver
outputs are encoded and replayed with the deployment's registry.

Browser/JSON storage and the generated SQLite migration preserve definitions and invalid saved
data; graph-only writes do not overwrite the registry. Deployment snapshots carry the same registry.
