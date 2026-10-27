import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The garbage-collection test calls `globalThis.gc`.
    execArgv: ["--expose-gc"],
  },
});
