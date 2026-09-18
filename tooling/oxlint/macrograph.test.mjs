import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import {
  noCrossPackageRelativeImports,
  noForbiddenArchitectureImports,
  noNodeImportsInBrowser,
} from "./macrograph.mjs";

// Oxlint is supplied by Vite+ rather than declared as a root dependency.
const vitePlusRequire = createRequire(import.meta.resolve("vite-plus/package.json"));
const { RuleTester } = await import(
  pathToFileURL(vitePlusRequire.resolve("oxlint/plugins-dev")).href
);

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ cwd: "/repo" });

tester.run("no-cross-package-relative-imports", noCrossPackageRelativeImports, {
  valid: [
    { filename: "/repo/packages/core/src/Graph.ts", code: 'import { Node } from "./Node.js"' },
    {
      filename: "/repo/packages/core/src/Graph.ts",
      code: 'import { Plugin } from "@macrograph/plugin"',
    },
  ],
  invalid: [
    {
      filename: "/repo/apps/web/src/App.ts",
      code: 'export { Graph } from "../../../packages/core/src/Graph.js"',
      errors: [{ messageId: "crossPackage", data: { from: "apps/web", to: "packages/core" } }],
    },
  ],
});

tester.run("no-forbidden-architecture-imports", noForbiddenArchitectureImports, {
  valid: [
    {
      filename: "/repo/packages/editor/src/Editor.ts",
      code: 'import { Graph } from "@macrograph/core"',
      options: [{ "packages/core": ["@macrograph/editor"] }],
    },
  ],
  invalid: [
    {
      filename: "/repo/packages/core/src/Graph.ts",
      code: 'const editor = import("@macrograph/editor/private")',
      options: [{ "packages/core": ["@macrograph/editor"] }],
      errors: [
        {
          messageId: "forbidden",
          data: { from: "packages/core", dependency: "@macrograph/editor" },
        },
      ],
    },
  ],
});

tester.run("no-node-imports-in-browser", noNodeImportsInBrowser, {
  valid: [
    {
      filename: "/repo/apps/playground/vite.config.ts",
      code: 'import path from "node:path"',
      options: [["apps/playground"]],
    },
    {
      filename: "/repo/apps/server/src/main.ts",
      code: 'import path from "node:path"',
      options: [["apps/playground"]],
    },
  ],
  invalid: [
    {
      filename: "/repo/apps/playground/src/main.ts",
      code: 'const fs = require("fs")',
      options: [["apps/playground"]],
      errors: [{ messageId: "nodeImport", data: { module: "fs" } }],
    },
  ],
});
