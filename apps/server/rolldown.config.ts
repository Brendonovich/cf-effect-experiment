import { defineConfig } from "rolldown";

// Modules are not bundled: built-ins are packaged into `dist/modules` by `build:modules` and loaded
// at runtime like any other module.
export default defineConfig({
  platform: "node",
  input: "src/index.ts",
  output: {
    dir: "dist/esm",
    format: "esm",
    minify: false,
  },
});
