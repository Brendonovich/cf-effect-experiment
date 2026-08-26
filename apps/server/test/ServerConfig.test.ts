import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { normalizeBasePath, normalizePublicOrigin } from "../src/ServerConfig.ts";
import { isInsideStaticRoot, isUnsafePath } from "../src/StaticRoutes.ts";

describe("server configuration", () => {
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
