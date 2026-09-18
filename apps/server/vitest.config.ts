import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/production.test.ts"],
    testTimeout: 30_000,
  },
});
