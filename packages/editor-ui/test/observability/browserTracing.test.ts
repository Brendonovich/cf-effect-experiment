import { describe, expect, it, vi } from "vitest";

import {
  initializeBrowserTracing,
  parseOtlpEndpoint,
  sanitizeNavigationPath,
} from "../../src/observability/browserTracing";

describe("browser tracing configuration", () => {
  it("is disabled for absent, invalid, and credential-bearing endpoints", () => {
    expect(parseOtlpEndpoint(undefined)).toBeUndefined();
    expect(parseOtlpEndpoint("not a url")).toBeUndefined();
    expect(parseOtlpEndpoint("ftp://collector.example/v1/traces")).toBeUndefined();
    expect(parseOtlpEndpoint("https://token@collector.example/v1/traces")).toBeUndefined();
    expect(parseOtlpEndpoint("https://collector.example/v1/traces?token=secret")).toBeUndefined();
  });

  it("accepts HTTP OTLP endpoints", () => {
    expect(parseOtlpEndpoint("https://collector.example/v1/traces")).toBe(
      "https://collector.example/v1/traces",
    );
  });

  it("does not initialize an exporter when tracing is disabled", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await initializeBrowserTracing(undefined);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it("removes workspace identifiers from navigation attributes", () => {
    expect(
      sanitizeNavigationPath(
        "/teams/private-team/projects/secret-project/editor",
      ),
    ).toBe("/teams/:id/projects/:id/editor");
    expect(
      sanitizeNavigationPath("/teams/private-team/projects/secret-project/deployments/deployment-1"),
    ).toBe("/teams/:id/projects/:id/deployments/:id");
  });
});
