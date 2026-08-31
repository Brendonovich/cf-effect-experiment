# Node Clipboard

`macrograph/nodes` version 1 is JSON text in the system clipboard. It contains node
models, internal connections, optional external connections, generated source IO,
and an editor-session/graph identity. Paste generates new node and connection IDs.
The UI snaps the common top-left anchor to the existing 40-unit grid and preserves
relative offsets, properties, encoded input defaults, and folded pins.

`PasteFragment` and `DeleteFragment` are write-authorized RPCs. Each validates before
publishing one event, persists through one `saveGraph`, and broadcasts only after
persistence succeeds. Cut writes the clipboard before deleting the captured source
graph selection. Schema metadata `internal: true` marks system-created nodes;
omitted metadata means false. Ordinary event nodes are not implicitly protected.

External links reconnect only within the same live editor service and graph.
Missing or invalid external endpoints and occupied inputs are skipped without a
prompt; existing wires are never replaced. Editor restart or a separate browser
playground instance changes the session identity and disables external reconnection.
This intentionally avoids trusting coincidentally equal project/graph/node IDs.

Resource references use constant IDs and exact `{ package, resource }` compatibility.
Foreign or missing resource references require explicit compatible-constant choices.
Missing schemas prompt for compatible schemas in the same package. Project-defined
packages use the `project-` namespace and require explicit choices across sessions.
Compatibility checks generated IO directions, kinds, field labels/order and types.
Confirmed schema rebinding remaps input defaults and connection port IDs. Every
retry revalidates against current destination state; cancel inserts nothing.

Custom event PR #17 registers `project-events` schemas (`emit:<id>` / `on:<id>`),
which this resolver supports at the package/IO contract level, including differing
field IDs. That PR is not merged into this branch; actual event-runtime integration
must be verified after combining the branches. Function definitions require their
package's generated schema/IO contract; system entry/return nodes must be internal.
Custom type descriptors from unmerged PR #15 are not supported by the base descriptor
codec, so foreign custom-type payloads fail safely rather than nominally binding IDs.
No definitions are imported and no same-name binding occurs without confirmation.

Payload limits: 1 MB UTF-8, 500 nodes, 2000 total connections, nesting depth 32,
finite coordinates within +/-10 million. Prototype-sensitive keys, duplicate IDs,
invalid internal endpoints, input cardinality, unknown properties, invalid defaults,
and incompatible internal wires reject the entire fragment.
