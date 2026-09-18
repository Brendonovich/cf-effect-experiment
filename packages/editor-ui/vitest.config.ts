import { Icons } from "@macrograph/icons/vite";
import { stylexProps } from "@macrograph/plugin/vite";
import solid from "@solidjs/vite-plugin";
import stylex from "@stylexjs/unplugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    Icons(new URL("./dist/test-auto-imports.d.ts", import.meta.url).pathname),
    stylexProps(),
    {
      ...stylex.vite({
        sxPropName: false,
        runtimeInjection: false,
        unstable_moduleResolution: {
          type: "commonJS",
          rootDir: new URL("../..", import.meta.url).pathname,
        },
      }),
      // StyleX's dev-server interval cannot clean up in Vitest's middleware mode.
      configureServer: undefined,
    },
    solid(),
    {
      name: "test-environment",
      config(config) {
        // Solid detects a transitive jest-dom package that this workspace cannot resolve.
        if (config.test) config.test.setupFiles = [];
      },
    },
  ],
  test: {
    environment: "happy-dom",
    // Let the adapter share the client-side Solid runtime mocked by the tests.
    server: { deps: { inline: ["@tanstack/solid-query"] } },
  },
});
