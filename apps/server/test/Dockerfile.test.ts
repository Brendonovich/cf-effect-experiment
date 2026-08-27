import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("production image", () => {
  it("uses a non-root runtime with persisted data and a healthcheck", async () => {
    const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
    expect(dockerfile).toContain("FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build");
    expect(dockerfile).toContain("FROM node:24-alpine AS runtime");
    expect(dockerfile).toContain('VOLUME ["/data"]');
    expect(dockerfile).toContain("USER 1000:1000");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("/health/ready");
    expect(dockerfile).toContain("pnpm install --frozen-lockfile");
    expect(dockerfile).toContain("/workspace/apps/server/dist ./dist");
    expect(dockerfile).toContain('CMD ["node", "dist/esm/index.js"]');
  });
});
