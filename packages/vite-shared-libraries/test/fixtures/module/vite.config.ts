import { SharedLibraries } from "@macrograph/module/SharedLibraries";
import stylex from "@stylexjs/unplugin";
import { join } from "node:path";
import { defineConfig } from "vite";

import { layerAnchors, stylexOptions } from "../../../src/StyleX.ts";

// Builds a module UI the way a third-party module would: its root is outside the monorepo, and
// every shared library stays an external bare import resolved by the host's import map.
const root = process.env.FIXTURE_ROOT ?? import.meta.dirname;

export default defineConfig({
  root,
  logLevel: "warn",
  plugins: [
    ...(process.env.FIXTURE_NO_ANCHORS === "1" ? [] : [layerAnchors()]),
    stylex.vite(stylexOptions()),
  ],
  build: {
    outDir: process.env.FIXTURE_OUT,
    emptyOutDir: true,
    lib: { entry: join(root, "src/ui.ts"), formats: ["es"], fileName: "ui", cssFileName: "ui" },
    rolldownOptions: { external: (id) => SharedLibraries.isShared(id, "browser") },
  },
});
