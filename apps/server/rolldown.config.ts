import { defineConfig } from "rolldown";

// Modules are not bundled: built-ins are packaged into `dist/modules` by `build:modules` and loaded
// at runtime like any other module.
export default defineConfig({
  platform: "node",
  input: "src/index.ts",
  // The channel the CLI serves unless MACROGRAPH_CHANNEL says otherwise; see src/Channel.ts.
  transform: {
    define: { MACROGRAPH_CHANNEL: JSON.stringify(process.env.MACROGRAPH_CHANNEL || "latest") },
  },
  output: {
    dir: "dist/esm",
    format: "esm",
    // The entry is the `macrograph` bin.
    banner: (chunk) => (chunk.isEntry ? "#!/usr/bin/env node" : ""),
    minify: false,
  },
});
