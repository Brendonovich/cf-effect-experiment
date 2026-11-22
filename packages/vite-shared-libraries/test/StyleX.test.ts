import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { canonicalStylexPath, resolveStylexImport, stylexOptions } from "../src/StyleX.ts";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const editorUi = join(repositoryRoot, "packages/editor-ui");

const publishedEditorUi = () => {
  const root = mkdtempSync(join(tmpdir(), "macrograph-stylex-"));
  const pkg = join(root, "node_modules/@macrograph/editor-ui");
  mkdirSync(join(pkg, "lib"), { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({
      name: "@macrograph/editor-ui",
      exports: { "./tokens.stylex": { types: "./lib/tokens.d.ts", import: "./lib/tokens.mjs" } },
    }),
  );
  writeFileSync(join(pkg, "lib/tokens.mjs"), "export const colors = {};\n");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/ui.ts"), "");
  return root;
};

describe("StyleX module resolution", () => {
  it("names exported theme files by their public specifier", () => {
    expect(canonicalStylexPath(join(editorUi, "src/tokens.stylex.ts"))).toBe(
      "@macrograph/editor-ui/tokens.stylex",
    );
    expect(canonicalStylexPath(join(editorUi, "src/events/events.stylex.ts"))).toBe(
      "@macrograph/editor-ui/events.stylex",
    );
  });

  it("names unexported theme files by package and path without extension", () => {
    expect(canonicalStylexPath(join(editorUi, "src/ui/Select.stylex.ts"))).toBe(
      "@macrograph/editor-ui:src/ui/Select.stylex",
    );
  });

  it("gives a published package with a different layout the same names", () => {
    const root = publishedEditorUi();
    const resolved = resolveStylexImport(
      "@macrograph/editor-ui/tokens.stylex",
      join(root, "src/ui.ts"),
    );
    expect(resolved).toMatch(/lib\/tokens\.mjs$/);
    expect(canonicalStylexPath(resolved ?? "")).toBe("@macrograph/editor-ui/tokens.stylex");
  });

  it("resolves relative and workspace theme imports to the same name", () => {
    const fromEvents = resolveStylexImport(
      "../tokens.stylex",
      join(editorUi, "src/events/events.stylex.ts"),
    );
    const fromApp = resolveStylexImport(
      "@macrograph/editor-ui/tokens.stylex",
      join(repositoryRoot, "apps/server/client/src/index.tsx"),
    );
    expect(fromEvents).toBeDefined();
    expect(fromApp).toBe(fromEvents);
  });

  it("uses the custom resolution in the shared options", () => {
    const options = stylexOptions();
    expect(options.unstable_moduleResolution?.type).toBe("custom");
    expect(options.useCSSLayers).toEqual({ before: ["reset"], prefix: "stylex" });
    expect(stylexOptions({ runtimeInjection: true }).runtimeInjection).toBe(true);
  });
});
