import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vite";

import { sharedLibraries } from "../../../src/SharedLibrariesPlugin.ts";
import { layerAnchors, stylexOptions } from "../../../src/StyleX.ts";

export default defineConfig({
  root: import.meta.dirname,
  base: "/host/",
  logLevel: "warn",
  plugins: [
    layerAnchors(),
    stylex.vite(stylexOptions()),
    sharedLibraries({
      specifiers: [
        "solid-js",
        "solid-js/*",
        "@solidjs/web",
        "effect",
        "effect/*",
        "@stylexjs/stylex",
      ],
    }),
  ],
  build: { outDir: process.env.FIXTURE_OUT, emptyOutDir: true },
});
