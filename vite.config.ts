import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: ["lib/**"],
    jsPlugins: [{ name: "macrograph", specifier: "./tooling/oxlint/macrograph.mjs" }],
    rules: {
      "macrograph/no-cross-package-relative-imports": "error",
      "macrograph/no-effect-v3-api": "error",
      "macrograph/no-private-workspace-subpath-imports": "error",
      "macrograph/no-schema-class-mutation": "error",
      "macrograph/no-unsafe-object-key-assignment": "error",
      "macrograph/prefer-curried-layer-effect": "error",
      "macrograph/require-safe-object-key-brand": "error",
      "macrograph/solid-v2-create-effect-signature": "error",
      "macrograph/solid-v2-no-eager-component-prop-read": "warn",
      "macrograph/solid-v2-no-mirrored-derived-state": "warn",
      "macrograph/solid-v2-no-untracked-render-callback-read": "error",
      "macrograph/solid-v2-prefer-effect-return-cleanup": "error",
      "macrograph/no-forbidden-architecture-imports": [
        "error",
        {
          "packages/module": [
            "@macrograph/core",
            "@macrograph/editor",
            "@macrograph/editor-ui",
            "@macrograph/execution",
            "@macrograph/persistence",
            "@macrograph/project-host",
          ],
          "packages/core": [
            "@macrograph/editor",
            "@macrograph/editor-ui",
            "@macrograph/execution",
            "@macrograph/persistence",
            "@macrograph/project-host",
          ],
          "packages/persistence": [
            "@macrograph/editor",
            "@macrograph/editor-ui",
            "@macrograph/execution",
            "@macrograph/project-host",
          ],
          "packages/execution": [
            "@macrograph/editor",
            "@macrograph/editor-ui",
            "@macrograph/persistence",
            "@macrograph/project-host",
          ],
          "packages/editor": ["@macrograph/editor-ui", "@macrograph/project-host"],
        },
      ],
      "macrograph/no-node-imports-in-browser": [
        "error",
        ["apps/cloudflare/frontend", "apps/playground", "apps/server/client", "packages/editor-ui"],
      ],
      "macrograph/no-unhandled-run-fork": [
        "error",
        ["apps/cloudflare/frontend", "apps/playground", "apps/server/client", "packages/editor-ui"],
      ],
    },
  },
  fmt: {
    ignorePatterns: ["lib/**"],
    sortImports: {
      groups: [
        "type-import",
        ["value-builtin", "value-external"],
        ["type-parent", "type-sibling", "type-index"],
        ["value-parent", "value-sibling", "value-index"],
        "type-internal",
        "value-internal",
        "unknown",
      ],
    },
  },
});
