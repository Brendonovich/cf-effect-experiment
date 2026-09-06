import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    stylex.vite({
      useCSSLayers: { before: ["reset"], prefix: "stylex" },
      runtimeInjection: false,
      unstable_moduleResolution: {
        type: "commonJS",
        rootDir: new URL("../../../..", import.meta.url).pathname,
      },
    }),
    solid(),
  ],
});
