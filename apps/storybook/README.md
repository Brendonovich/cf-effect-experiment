# MacroGraph Storybook

Run the component explorer from the workspace root:

```sh
pnpm storybook
```

Build the standalone site with:

```sh
pnpm storybook:build
```

Stories are colocated with their components in `packages/editor-ui/src/` and `packages/plugins/*/src/`, covering shared editor components, complete editor states, and every visual plugin settings interface. The app uses the same Solid 2, StyleX, and icon transforms as MacroGraph's production frontends.
