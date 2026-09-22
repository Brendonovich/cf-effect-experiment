import { defineConfig } from "vitest/config";

import config from "./vite.config";

export default defineConfig({
  ...config,
  plugins: [
    ...(config.plugins ?? [])
      .filter((plugin) => !(plugin && "name" in plugin && plugin.name === "vite-opencode-picker"))
      .map((plugin) =>
        // StyleX's dev-server interval cannot clean up in Vitest's middleware mode.
        plugin && "name" in plugin && plugin.name === "@stylexjs/unplugin"
          ? { ...plugin, configureServer: undefined }
          : plugin,
      ),
    {
      name: "test-environment",
      config(config) {
        // The Solid plugin detects a transitive jest-dom that this package cannot resolve.
        if (config.test) config.test.setupFiles = [];
      },
    },
  ],
  test: { environment: "jsdom" },
});
