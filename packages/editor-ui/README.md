# Editor UI

Shared Solid UI for MacroGraph's editor, runtime events, and account settings.

## Organization

- `src/account/`: account menu and identity presentation.
- `src/credentials/`: credential authorization and credential tables.
- `src/editor/`: editor composition, controller, commands, store, and shortcuts.
- `src/editor/catalog/`: browsing and searching graphs, packages, and resources.
- `src/editor/graph/`: graph rendering, canvas interactions, and connection authoring.
- `src/editor/inspector/`: node inspection and schema-driven property controls.
- `src/editor/modules/`: module settings views and connected module data.
- `src/editor/session/`: editor connection lifecycle and collaborative presence.
- `src/editor/workspace/`: panes, tabs, layout, and persisted workspace state.
- `src/events/`: event presentation, live activity, and event styles.
- `src/observability/`: browser tracing and traced Effect runners.
- `src/ui/`: domain-independent UI and reactive primitives. `createPresence` here controls animation/unmount presence, not collaboration.

Keep stories beside their components and tests under the matching domain in
`test/`. Shared editor story data lives in `src/editor/storybook-fixtures.ts`.
Import internal modules directly; `src/index.ts` and the package export map define
the public API. Global CSS and design tokens remain at the source root.

## Schema authoring

The UI does not recognize built-in schema IDs. Browser-safe behavior is registered
through `SchemaAuthoring.Registry` in `@macrograph/core`, inspired by the original
MacroGraph's `createIO` and property `source` callbacks:

- `generateIO(context)` returns a `Result<NodeIO, string>`. It can inspect current
  properties, project type definitions, resolved type variables, and connected
  input scopes. Return anchor ports even when a type is unresolved; return a
  failure for an invalid selection or inferred type. Never reuse inferred fields
  from `context.declared` as anchors.
- `properties[propertyId].options(context)` supplies the generic inspector select.
  Sources may depend on other property values and current project definitions.
  Property descriptions remain in the serializable package model.
- `acceptsInput(inputId, type, definitions)` constrains connection-driven creation
  candidates and local inference. Allow unresolved wildcards when inference can
  subsequently determine an acceptable type.

`BuiltinAuthoring.registry` installs the built-in schemas. Hosts can extend it
with `.with({ model, schemas })` and pass the resulting registry to
`createEditorController({ authoring, ... })`. The same registration can supply
property-dependent base IO through `Packages.layer(authoring)` on the server.
Runtime execution implementations and server-side connection validation still
belong to the server; registering browser authoring behavior alone does not
install an executable module.

The shared `SchemaAuthoring.GraphResolver` iterates IO generation and wildcard
solving to a fixed point, starts without stale inferred pins, and reports failures
through node diagnostics. Its cache ignores node names/positions. Built-in catalog
models are static; type-definition events invalidate IO rather than rebuild packages.

## Verification

- `pnpm typecheck` from the repository root.
- `pnpm --filter @macrograph/editor-ui test`.
- `pnpm storybook:build` to check stories and UI transforms.
