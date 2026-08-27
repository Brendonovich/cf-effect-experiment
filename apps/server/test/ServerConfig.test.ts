import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { makeServerConfig, normalizeBasePath, normalizePublicOrigin } from "../src/ServerConfig.ts";
import { isInsideStaticRoot, isUnsafePath } from "../src/StaticRoutes.ts";

describe("server configuration", () => {
  it("disables tracing without a collector endpoint", () => {
    expect(makeServerConfig({}).otlpEndpoint).toBeUndefined();
    expect(makeServerConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: " " }).otlpEndpoint).toBeUndefined();
    expect(makeServerConfig({}).otlpServiceName).toBe("macrograph-server");
  });

  it("appends the trace path to collector base URLs and preserves existing trace URLs", () => {
    for (const [endpoint, expected] of [
      ["http://localhost:4318", "http://localhost:4318/v1/traces"],
      ["https://collector.example/otel/", "https://collector.example/otel/v1/traces"],
      ["https://collector.example/v1/traces", "https://collector.example/v1/traces"],
    ]) {
      expect(makeServerConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint }).otlpEndpoint).toBe(
        expected,
      );
    }
  });

  it("uses trace-specific endpoints exactly and gives them precedence", () => {
    expect(
      makeServerConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://collector.example/custom",
      }).otlpEndpoint,
    ).toBe("https://collector.example/custom");
    expect(
      makeServerConfig({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://localhost:4318",
      }).otlpEndpoint,
    ).toBe("http://localhost:4318/");
  });

  it("accepts only HTTP collector URLs without embedded credentials or fragments", () => {
    for (const endpoint of [
      "not a url",
      "grpc://localhost:4317",
      "https://token@collector.example",
      "https://collector.example/#traces",
    ]) {
      expect(() => makeServerConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint })).toThrow(
        "OTLP endpoint",
      );
    }
  });

  it("configures the service name and percent-decoded collector headers", () => {
    const config = makeServerConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
      OTEL_SERVICE_NAME: " my-macrograph ",
      OTEL_EXPORTER_OTLP_HEADERS:
        "Authorization=Bearer%20secret, x-dataset=macrograph%2Cprod,x-token=abc==",
    });
    expect(config.otlpServiceName).toBe("my-macrograph");
    expect(config.otlpHeaders).toEqual({
      authorization: "Bearer secret",
      "x-dataset": "macrograph,prod",
      "x-token": "abc==",
    });
    expect(
      makeServerConfig({
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
        OTEL_EXPORTER_OTLP_HEADERS: "authorization=general",
        OTEL_EXPORTER_OTLP_TRACES_HEADERS: "authorization=traces",
      }).otlpHeaders,
    ).toEqual({ authorization: "traces" });
  });

  it("rejects malformed collector headers without exposing their values", () => {
    for (const headers of [
      "secret",
      "=secret",
      "invalid name=secret",
      "authorization=secret%0D%0A",
      "authorization=secret%ZZ",
    ]) {
      expect(() =>
        makeServerConfig({
          OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
          OTEL_EXPORTER_OTLP_HEADERS: headers,
        }),
      ).toThrow(/^(?!.*secret)/);
    }
  });

  it("normalizes public base paths", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath("/macrograph/")).toBe("/macrograph");
    expect(() => normalizeBasePath("relative")).toThrow();
    expect(() => normalizeBasePath("//example.com/path")).toThrow();
    expect(() => normalizeBasePath("/safe/%2e%2e/escape")).toThrow();
    expect(() => normalizeBasePath("/safe%2fescape")).toThrow();
  });

  it("accepts only plain HTTP public origins", () => {
    expect(normalizePublicOrigin("https://example.com/")).toBe("https://example.com");
    expect(() => normalizePublicOrigin("https://example.com/prefix")).toThrow();
    expect(() => normalizePublicOrigin("https://token@example.com")).toThrow();
    expect(() => normalizePublicOrigin("file:///tmp/app")).toThrow();
  });

  it("rejects traversal and malformed paths", () => {
    expect(isUnsafePath("/%2e%2e/package.json")).toBe(true);
    expect(isUnsafePath("/..%2fpackage.json")).toBe(true);
    expect(isUnsafePath("/assets/.env")).toBe(true);
    expect(isUnsafePath("/assets/%2econfig")).toBe(true);
    expect(isUnsafePath("/assets/app.js")).toBe(false);
  });

  it("does not follow static file symlinks outside the asset root", () => {
    const root = mkdtempSync(join(tmpdir(), "macrograph-static-root-"));
    const outside = mkdtempSync(join(tmpdir(), "macrograph-static-outside-"));
    try {
      writeFileSync(join(root, "index.html"), "app");
      writeFileSync(join(outside, "secret.txt"), "secret");
      symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));
      expect(isInsideStaticRoot(root, "/escape.txt")).toBe(false);
      expect(isInsideStaticRoot(root, "/missing-browser-route")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
