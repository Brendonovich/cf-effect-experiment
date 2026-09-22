import { builtinModules } from "node:module";
import path from "node:path";

const nodeModules = new Set(builtinModules.flatMap((name) => [name, name.replace(/^node:/, "")]));

const normalize = (value) => value.replaceAll("\\", "/");

const workspaceUnit = (filename) => {
  const match = normalize(filename).match(
    /\/(apps\/(?:cloudflare\/frontend|server\/client|[^/]+)|packages\/(?:modules\/[^/]+|[^/]+))(?:\/|$)/,
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

const importedLocal = (specifier) => specifier.local?.name ?? specifier.imported?.name;

const memberName = (node) =>
  node?.type === "MemberExpression" && !node.computed
    ? node.property.name
    : node?.type === "MemberExpression" && node.computed
      ? staticSpecifier(node.property)
      : undefined;

const walk = (node, visit, skipNestedFunctions = false, root = true) => {
  if (node === null || typeof node !== "object") return false;
  if (
    skipNestedFunctions &&
    !root &&
    ["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"].includes(node.type)
  )
    return false;
  if (visit(node)) return true;
  for (const [key, value] of Object.entries(node)) {
    if (["parent", "loc", "range", "tokens", "comments"].includes(key)) continue;
    if (Array.isArray(value)) {
      if (value.some((child) => walk(child, visit, skipNestedFunctions, false))) return true;
    } else if (walk(value, visit, skipNestedFunctions, false)) return true;
  }
  return false;
};

const isPropsRead = (node) =>
  node.type === "MemberExpression" &&
  node.object?.type === "Identifier" &&
  node.object.name === "props";

const functionName = (node) =>
  node.type === "FunctionDeclaration"
    ? node.id?.name
    : node.type === "VariableDeclarator"
      ? node.id?.name
      : undefined;

const functionValue = (node) =>
  node.type === "FunctionDeclaration"
    ? node
    : node.type === "VariableDeclarator" &&
        ["ArrowFunctionExpression", "FunctionExpression"].includes(node.init?.type)
      ? node.init
      : undefined;

const topLevelDeclarations = (fn) =>
  fn?.body?.type === "BlockStatement"
    ? fn.body.body.flatMap((statement) =>
        statement.type === "VariableDeclaration" ? statement.declarations : [],
      )
    : [];

const isDeferredInitializer = (node, reactiveFactories) =>
  ["ArrowFunctionExpression", "FunctionExpression"].includes(node?.type) ||
  (node?.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    reactiveFactories.has(node.callee.name));

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

export const solidV2CreateEffectSignature = {
  meta: {
    type: "problem",
    schema: false,
    messages: {
      arity: "Solid 2 createEffect requires an explicit source and callback.",
      async: "Solid 2 effect callbacks must be synchronous and return cleanup directly.",
    },
  },
  create(context) {
    const effects = new Set();
    return {
      ImportDeclaration(node) {
        if (staticSpecifier(node.source) !== "solid-js") return;
        for (const specifier of node.specifiers)
          if (specifier.imported?.name === "createEffect") effects.add(importedLocal(specifier));
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || !effects.has(node.callee.name)) return;
        if (node.arguments.length !== 2) context.report({ node, messageId: "arity" });
        const callback = node.arguments[1];
        if (
          callback?.async === true &&
          ["ArrowFunctionExpression", "FunctionExpression"].includes(callback.type)
        )
          context.report({ node: callback, messageId: "async" });
      },
    };
  },
};

export const solidV2PreferEffectReturnCleanup = {
  meta: {
    type: "suggestion",
    schema: false,
    messages: {
      cleanup:
        "Return cleanup from the Solid 2 effect callback instead of registering onCleanup inside it.",
    },
  },
  create(context) {
    const effects = new Set();
    const cleanups = new Set();
    return {
      ImportDeclaration(node) {
        if (staticSpecifier(node.source) !== "solid-js") return;
        for (const specifier of node.specifiers) {
          if (specifier.imported?.name === "createEffect") effects.add(importedLocal(specifier));
          if (specifier.imported?.name === "onCleanup") cleanups.add(importedLocal(specifier));
        }
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || !effects.has(node.callee.name)) return;
        const callback = node.arguments[1];
        if (
          callback === undefined ||
          !["ArrowFunctionExpression", "FunctionExpression"].includes(callback.type)
        )
          return;
        const nestedCleanup = walk(
          callback.body,
          (child) =>
            child.type === "CallExpression" &&
            child.callee.type === "Identifier" &&
            cleanups.has(child.callee.name),
          true,
        );
        if (nestedCleanup) context.report({ node: callback, messageId: "cleanup" });
      },
    };
  },
};

export const solidV2NoEagerComponentPropRead = {
  meta: {
    type: "suggestion",
    schema: false,
    messages: {
      destructure: "Do not destructure props in a Solid 2 component; keep them reactive.",
      eager:
        "Do not eagerly read props in a Solid 2 component body; use JSX, an accessor, or createMemo.",
    },
  },
  create(context) {
    const reactiveFactories = new Set();
    const check = (node) => {
      const name = functionName(node);
      const fn = functionValue(node);
      if (fn === undefined || name === undefined || !/^[A-Z]/.test(name)) return;
      if (fn.params.some((parameter) => parameter.type === "ObjectPattern"))
        context.report({
          node: fn.params.find((parameter) => parameter.type === "ObjectPattern"),
          messageId: "destructure",
        });
      for (const declaration of topLevelDeclarations(fn)) {
        const initializer = declaration.init;
        if (initializer === null || isDeferredInitializer(initializer, reactiveFactories)) continue;
        if (walk(initializer, isPropsRead, true))
          context.report({ node: initializer, messageId: "eager" });
      }
    };
    return {
      ImportDeclaration(node) {
        if (staticSpecifier(node.source) !== "solid-js") return;
        for (const specifier of node.specifiers)
          if (["createMemo", "createSignal"].includes(specifier.imported?.name))
            reactiveFactories.add(importedLocal(specifier));
      },
      FunctionDeclaration: check,
      VariableDeclarator: check,
    };
  },
};

export const solidV2NoUntrackedRenderCallbackRead = {
  meta: {
    type: "problem",
    schema: false,
    messages: {
      untracked:
        "Show and For callbacks are not tracking scopes; defer this reactive read with createMemo or an accessor.",
    },
  },
  create(context) {
    const memos = new Set(["createMemo"]);
    return {
      ImportDeclaration(node) {
        if (staticSpecifier(node.source) !== "solid-js") return;
        for (const specifier of node.specifiers)
          if (specifier.imported?.name === "createMemo") memos.add(importedLocal(specifier));
      },
      JSXElement(node) {
        const control = node.openingElement?.name;
        if (control?.type !== "JSXIdentifier" || !["Show", "For"].includes(control.name)) return;
        for (const child of node.children ?? []) {
          const callback = child.type === "JSXExpressionContainer" ? child.expression : undefined;
          if (
            callback?.type !== "ArrowFunctionExpression" ||
            callback.body.type !== "BlockStatement"
          )
            continue;
          const callbackAccessors = new Set(
            callback.params.flatMap((parameter, index) =>
              parameter.type === "Identifier" && (control.name === "Show" || index > 0)
                ? [parameter.name]
                : [],
            ),
          );
          for (const declaration of topLevelDeclarations(callback)) {
            const initializer = declaration.init;
            if (initializer === null || isDeferredInitializer(initializer, memos)) continue;
            const reactiveRead = walk(
              initializer,
              (candidate) =>
                isPropsRead(candidate) ||
                (candidate.type === "CallExpression" &&
                  candidate.callee.type === "Identifier" &&
                  callbackAccessors.has(candidate.callee.name)),
              true,
            );
            if (reactiveRead) context.report({ node: initializer, messageId: "untracked" });
          }
        }
      },
    };
  },
};

export const solidV2NoMirroredDerivedState = {
  meta: {
    type: "suggestion",
    schema: false,
    messages: {
      mirrored: "Prefer createMemo to copying an effect source directly into another signal.",
    },
  },
  create(context) {
    const effects = new Set();
    const setters = new Set();
    return {
      ImportDeclaration(node) {
        if (staticSpecifier(node.source) !== "solid-js") return;
        for (const specifier of node.specifiers)
          if (specifier.imported?.name === "createEffect") effects.add(importedLocal(specifier));
      },
      VariableDeclarator(node) {
        if (
          node.id.type === "ArrayPattern" &&
          node.id.elements[1]?.type === "Identifier" &&
          node.init?.type === "CallExpression" &&
          node.init.callee.type === "Identifier" &&
          node.init.callee.name === "createSignal"
        )
          setters.add(node.id.elements[1].name);
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || !effects.has(node.callee.name)) return;
        const callback = node.arguments[1];
        if (callback?.type !== "ArrowFunctionExpression") return;
        const sourceValue = callback.params[0];
        if (sourceValue?.type !== "Identifier") return;
        const expression =
          callback.body.type === "BlockStatement" &&
          callback.body.body.length === 1 &&
          callback.body.body[0].type === "ExpressionStatement"
            ? callback.body.body[0].expression
            : callback.body;
        if (
          expression.type === "CallExpression" &&
          expression.callee.type === "Identifier" &&
          setters.has(expression.callee.name) &&
          expression.arguments.some((argument) =>
            walk(
              argument,
              (candidate) => candidate.type === "Identifier" && candidate.name === sourceValue.name,
              true,
            ),
          )
        )
          context.report({ node: callback, messageId: "mirrored" });
      },
    };
  },
};

export const noEffectV3Api = {
  meta: {
    type: "problem",
    schema: false,
    messages: {
      catchAll: "Effect.catchAll is not available in Effect v4; inspect the Cause with catchCause.",
      tryCatch: "Effect.try requires an explicit catch handler in Effect v4.",
    },
  },
  create(context) {
    const effects = new Set();
    return {
      ImportDeclaration(node) {
        if (staticSpecifier(node.source) !== "effect") return;
        for (const specifier of node.specifiers)
          if (
            specifier.imported?.name === "Effect" ||
            specifier.type === "ImportNamespaceSpecifier"
          )
            effects.add(importedLocal(specifier));
      },
      CallExpression(node) {
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.object.type !== "Identifier" ||
          !effects.has(node.callee.object.name)
        )
          return;
        const method = memberName(node.callee);
        if (method === "catchAll") context.report({ node, messageId: "catchAll" });
        if (method !== "try") return;
        const options = node.arguments[0];
        const hasCatch =
          options?.type === "ObjectExpression" &&
          options.properties.some(
            (property) =>
              property.type === "Property" &&
              (property.key.name === "catch" || staticSpecifier(property.key) === "catch"),
          );
        if (!hasCatch) context.report({ node, messageId: "tryCatch" });
      },
    };
  },
};

export const preferCurriedLayerEffect = {
  meta: {
    type: "problem",
    schema: false,
    messages: {
      curried: "Use Layer.effect(Tag)(effect) to preserve Effect v4 type inference.",
    },
  },
  create(context) {
    const layers = new Set();
    return {
      ImportDeclaration(node) {
        if (staticSpecifier(node.source) !== "effect") return;
        for (const specifier of node.specifiers)
          if (specifier.imported?.name === "Layer") layers.add(importedLocal(specifier));
      },
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          layers.has(node.callee.object.name) &&
          memberName(node.callee) === "effect" &&
          node.arguments.length > 1
        )
          context.report({ node, messageId: "curried" });
      },
    };
  },
};

export const noUnhandledRunFork = {
  meta: {
    type: "problem",
    schema: false,
    messages: {
      fork: "Use the application lifecycle runner instead of detaching Effect.runFork directly.",
    },
  },
  create(context) {
    const effects = new Set();
    const browserRoots = context.options[0] ?? [];
    const unit = workspaceUnit(context.filename);
    if (unit === undefined || !browserRoots.includes(unit)) return {};
    return {
      ImportDeclaration(node) {
        if (staticSpecifier(node.source) !== "effect") return;
        for (const specifier of node.specifiers)
          if (specifier.imported?.name === "Effect") effects.add(importedLocal(specifier));
      },
      CallExpression(node) {
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.object.type === "Identifier" &&
          effects.has(node.callee.object.name) &&
          memberName(node.callee) === "runFork"
        )
          context.report({ node, messageId: "fork" });
      },
    };
  },
};

export const noPrivateWorkspaceSubpathImports = {
  meta: {
    type: "problem",
    schema: false,
    messages: {
      private: "Import {{specifier}} through an exported workspace package entry point.",
    },
  },
  create(context) {
    return moduleVisitors((node) => {
      const specifier = staticSpecifier(node);
      if (
        typeof specifier === "string" &&
        /^@macrograph\/[^/]+\/(?:src|test|dist|private)(?:\/|$)/.test(specifier)
      )
        context.report({ node, messageId: "private", data: { specifier } });
    });
  },
};

export const noSchemaClassMutation = {
  meta: {
    type: "problem",
    schema: false,
    messages: {
      mutation:
        "Schema.Class instances are immutable; construct a new instance with the updated field.",
    },
  },
  create(context) {
    const schemas = new Set();
    const classes = new Set();
    const instances = new Set();
    const isSchemaClass = (node) =>
      walk(node, (candidate) => {
        if (
          candidate.type !== "MemberExpression" ||
          candidate.object.type !== "Identifier" ||
          !schemas.has(candidate.object.name)
        )
          return false;
        return ["Class", "TaggedClass", "TaggedError"].includes(memberName(candidate));
      });
    return {
      ImportDeclaration(node) {
        if (staticSpecifier(node.source) !== "effect") return;
        for (const specifier of node.specifiers)
          if (specifier.imported?.name === "Schema") schemas.add(importedLocal(specifier));
      },
      ClassDeclaration(node) {
        if (node.id !== null && isSchemaClass(node.superClass)) classes.add(node.id.name);
      },
      VariableDeclarator(node) {
        if (
          node.id.type === "Identifier" &&
          node.init?.type === "NewExpression" &&
          node.init.callee.type === "Identifier" &&
          classes.has(node.init.callee.name)
        )
          instances.add(node.id.name);
      },
      AssignmentExpression(node) {
        if (node.left.type !== "MemberExpression") return;
        const target = node.left.object;
        const knownInstance = target.type === "Identifier" && instances.has(target.name);
        const directInstance =
          target.type === "NewExpression" &&
          target.callee.type === "Identifier" &&
          classes.has(target.callee.name);
        if (knownInstance || directInstance) context.report({ node, messageId: "mutation" });
      },
    };
  },
};

export default {
  meta: { name: "macrograph" },
  rules: {
    "no-cross-package-relative-imports": noCrossPackageRelativeImports,
    "no-forbidden-architecture-imports": noForbiddenArchitectureImports,
    "no-node-imports-in-browser": noNodeImportsInBrowser,
    "solid-v2-create-effect-signature": solidV2CreateEffectSignature,
    "solid-v2-prefer-effect-return-cleanup": solidV2PreferEffectReturnCleanup,
    "solid-v2-no-eager-component-prop-read": solidV2NoEagerComponentPropRead,
    "solid-v2-no-untracked-render-callback-read": solidV2NoUntrackedRenderCallbackRead,
    "solid-v2-no-mirrored-derived-state": solidV2NoMirroredDerivedState,
    "no-effect-v3-api": noEffectV3Api,
    "prefer-curried-layer-effect": preferCurriedLayerEffect,
    "no-unhandled-run-fork": noUnhandledRunFork,
    "no-private-workspace-subpath-imports": noPrivateWorkspaceSubpathImports,
    "no-schema-class-mutation": noSchemaClassMutation,
  },
};
