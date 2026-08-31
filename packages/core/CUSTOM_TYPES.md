# Custom Types Foundation

This is the non-destructive foundation for issue #6, not the complete authoring feature.

Project models carry a `types` registry keyed by stable definition identity. Old persisted
projects decode with an empty registry. Struct fields and tagged enum payloads use the
same descriptors as pins, including nested List, Option, and Custom references.

`DataType.Custom(DefinitionId.make(id))` refers to a project definition. Compatibility
compares identity, recursively through containers. Runtime objects include `_type` with
the definition identity; enum objects additionally include `_tag` with the variant name.
This ensures structurally identical definitions cannot exchange values accidentally.
These marker keys are reserved and are retained in JSON conversion.

Pass the current project's registry to `ValueSchema`, `JsonValueSchema`, or `isValue`.
Resolution is suspended for recursion and has no global registry. A missing definition
fails validation. Runtime defaults, connected values, and execution-driver replay use
the project's registry. JSON and SQLite persistence retain definitions on graph saves.

`TypeDefinition.validate` validates an entire candidate registry, including mutually
recursive definitions. It checks identity, names, reserved/duplicate fields, dangling
references, and whether recursive types admit a finite value. List/Option or a terminal
enum variant can terminate recursion. This validation is not yet wired into authoring
mutations because those mutations are not provided by this foundation.

## Remaining Scope

- Project-wide authoring UI and collaborative mutation events/RPCs.
- Make, break, and update structs; construct and match enum variants.
- Structured default editors, JSON conversion nodes, and collection-node type selection.
- Dependency/impact previews across definitions, nodes, connections, defaults, and variables.
- Confirmation with stale-preview protection and the agreed invalidation/migration policy.
- Browser scenarios proving the complete feature, rather than only editor smoke coverage.

The owner requested a warning and confirmation when changing in-use definitions, but
the resulting migration policy remains unresolved: preserve incompatible data visibly
invalid and prevent execution until repair, or explicitly remove/reset affected data.
The clarification is tracked at:
https://github.com/Brendonovich/cf-effect-experiment/issues/6#issuecomment-5474640852

No type edit/delete mutation is exposed here. Do not reuse the existing IO-change
default-pruning helper for type migrations without the confirmed policy and impact
preview. Arbitrary cyclic JavaScript object graphs are not supported; recursive types
describe finite JSON-serializable values.
