# Editor UI

Shared Solid UI for MacroGraph's editor, runtime events, and account settings.

## Organization

- `src/account/`: account menu and identity presentation.
- `src/credentials/`: credential authorization and credential tables.
- `src/editor/`: editor composition, controller, commands, store, and shortcuts.
- `src/editor/catalog/`: browsing and searching graphs, packages, and resources.
- `src/editor/graph/`: graph rendering, canvas interactions, and connection authoring.
- `src/editor/inspector/`: node inspection and schema-driven property controls.
- `src/editor/plugins/`: plugin settings views and connected plugin data.
- `src/editor/session/`: editor connection lifecycle and collaborative presence.
- `src/editor/workspace/`: panes, tabs, layout, and persisted workspace state.
- `src/events/`: event presentation, live activity, and event styles.
- `src/observability/`: browser tracing and traced Effect runners.
- `src/ui/`: domain-independent UI and reactive primitives. `createPresence` here controls animation/unmount presence, not collaboration.

Keep stories beside their components and tests under the matching domain in
`test/`. Shared editor story data lives in `src/editor/storybook-fixtures.ts`.
Import internal modules directly; `src/index.ts` and the package export map define
the public API. Global CSS and design tokens remain at the source root.

## Verification

- `pnpm typecheck` from the repository root.
- `pnpm --filter @macrograph/editor-ui test`.
- `pnpm storybook:build` to check stories and UI transforms.
