import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Let the adapter share the client-side Solid runtime mocked by the tests.
    server: { deps: { inline: ["@tanstack/solid-query"] } },
  },
});
