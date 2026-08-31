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

The project-scoped `CustomTypes` built-in package shares one schema generator between editor
and executor. Schema IDs encode definition identity, operation and optional member as JSON
arrays, so renaming a type does not break nodes. Fields and variants retain name-based identity
from the original persisted format; renaming a member intentionally exposes old pins for repair.

- Make and break structs; per-field immutable update preserves all other fields.
- Construct each tagged variant; match chooses an execution branch and exposes only its payload.
- Parse and stringify JSON through current project codecs, retaining nominal markers.
- Existing List operations accept custom and nested container types through the type picker.

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
