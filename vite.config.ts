import { defineConfig } from "vite-plus";

export default defineConfig({
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
