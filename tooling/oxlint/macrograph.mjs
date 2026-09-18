import { builtinModules } from "node:module";
import path from "node:path";

const nodeModules = new Set(builtinModules.flatMap((name) => [name, name.replace(/^node:/, "")]));

const normalize = (value) => value.replaceAll("\\", "/");

const workspaceUnit = (filename) => {
  const match = normalize(filename).match(
    /\/(apps\/(?:cloudflare\/frontend|server\/client|[^/]+)|packages\/(?:plugins\/[^/]+|[^/]+))(?:\/|$)/,
  );
  return match?.[1];
};

const packageSpecifier = (specifier) =>
  specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];

const moduleVisitors = (check) => ({
  ImportDeclaration: (node) => check(node.source),
  ExportAllDeclaration: (node) => check(node.source),
  ExportNamedDeclaration: (node) => {
    if (node.source !== null) check(node.source);
  },
  ImportExpression: (node) => check(node.source),
  CallExpression: (node) => {
    if (
      node.callee.type === "Identifier" &&
      node.callee.name === "require" &&
      node.arguments.length === 1
    )
      check(node.arguments[0]);
  },
});

const staticSpecifier = (node) => (node?.type === "Literal" ? node.value : node?.value);

export const noCrossPackageRelativeImports = {
  meta: {
    type: "problem",
    messages: {
      crossPackage:
        "Use the target package's public workspace import instead of a relative import from {{from}} to {{to}}.",
    },
  },
  create(context) {
    const from = workspaceUnit(context.filename);
    return moduleVisitors((node) => {
      const specifier = staticSpecifier(node);
      if (from === undefined || typeof specifier !== "string" || !specifier.startsWith(".")) return;
      const target = path.resolve(path.dirname(context.filename), specifier);
      const to = workspaceUnit(target);
      if (to !== undefined && to !== from)
        context.report({ node, messageId: "crossPackage", data: { from, to } });
    });
  },
};

export const noForbiddenArchitectureImports = {
  meta: {
    type: "problem",
    schema: false,
    messages: {
      forbidden: "{{from}} must not depend on the higher architecture layer {{dependency}}.",
    },
  },
  create(context) {
    const from = workspaceUnit(context.filename);
    const restrictions = context.options[0] ?? {};
    const forbidden = from === undefined ? [] : (restrictions[from] ?? []);
    return moduleVisitors((node) => {
      const specifier = staticSpecifier(node);
      if (typeof specifier !== "string" || specifier.startsWith(".")) return;
      const dependency = packageSpecifier(specifier);
      if (forbidden.includes(dependency))
        context.report({ node, messageId: "forbidden", data: { from, dependency } });
    });
  },
};

export const noNodeImportsInBrowser = {
  meta: {
    type: "problem",
    schema: false,
    messages: { nodeImport: "Browser source must not import the Node.js module {{module}}." },
  },
  create(context) {
    const browserRoots = context.options[0] ?? [];
    const unit = workspaceUnit(context.filename);
    const isBrowserSource =
      unit !== undefined &&
      browserRoots.includes(unit) &&
      normalize(context.filename).includes("/src/");
    return moduleVisitors((node) => {
      const specifier = staticSpecifier(node);
      if (!isBrowserSource || typeof specifier !== "string") return;
      const module = specifier.replace(/^node:/, "").split("/")[0];
      if (specifier.startsWith("node:") || nodeModules.has(module))
        context.report({ node, messageId: "nodeImport", data: { module: specifier } });
    });
  },
};

export default {
  meta: { name: "macrograph" },
  rules: {
    "no-cross-package-relative-imports": noCrossPackageRelativeImports,
    "no-forbidden-architecture-imports": noForbiddenArchitectureImports,
    "no-node-imports-in-browser": noNodeImportsInBrowser,
  },
};
