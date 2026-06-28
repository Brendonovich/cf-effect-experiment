import { defineConfig } from "rolldown";

export default defineConfig({
  platform: "node",
  input: "src/index.ts",
  output: {
    dir: "dist/esm",
    format: "esm",
  },
});
