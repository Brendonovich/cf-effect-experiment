import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import {
  noEffectV3Api,
  noCrossPackageRelativeImports,
  noForbiddenArchitectureImports,
  noNodeImportsInBrowser,
  noPrivateWorkspaceSubpathImports,
  noSchemaClassMutation,
  noUnhandledRunFork,
  preferCurriedLayerEffect,
  solidV2CreateEffectSignature,
  solidV2NoEagerComponentPropRead,
  solidV2NoMirroredDerivedState,
  solidV2NoUntrackedRenderCallbackRead,
  solidV2PreferEffectReturnCleanup,
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
    {
      filename: "/repo/packages/modules/list/src/Module.ts",
      code: 'import MathModule from "../../math/src/Module.ts"',
      errors: [
        {
          messageId: "crossPackage",
          data: { from: "packages/modules/list", to: "packages/modules/math" },
        },
      ],
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

tester.run("solid-v2-create-effect-signature", solidV2CreateEffectSignature, {
  valid: [
    {
      code: 'import { createEffect } from "solid-js"; createEffect(() => props.id, id => console.log(id))',
    },
  ],
  invalid: [
    {
      code: 'import { createEffect } from "solid-js"; createEffect(() => console.log(props.id))',
      errors: [{ messageId: "arity" }],
    },
    {
      code: 'import { createEffect } from "solid-js"; createEffect(() => props.id, async id => id)',
      errors: [{ messageId: "async" }],
    },
  ],
});

tester.run("solid-v2-prefer-effect-return-cleanup", solidV2PreferEffectReturnCleanup, {
  valid: [
    {
      code: 'import { createEffect } from "solid-js"; createEffect(source, value => { listen(value); return () => unlisten(value) })',
    },
  ],
  invalid: [
    {
      code: 'import { createEffect, onCleanup } from "solid-js"; createEffect(source, value => { listen(value); onCleanup(() => unlisten(value)) })',
      errors: [{ messageId: "cleanup" }],
    },
  ],
});

tester.run("solid-v2-no-eager-component-prop-read", solidV2NoEagerComponentPropRead, {
  valid: [
    {
      filename: "/repo/packages/editor-ui/src/Greeting.tsx",
      code: 'import { createMemo } from "solid-js"; const Greeting = props => { const label = createMemo(() => props.name); return <p>{label()}</p> }',
    },
    {
      filename: "/repo/packages/editor-ui/src/Greeting.tsx",
      code: "const Greeting = props => { const submit = () => props.onSubmit(); return <button onClick={submit} /> }",
    },
  ],
  invalid: [
    {
      filename: "/repo/packages/editor-ui/src/Greeting.tsx",
      code: "const Greeting = props => { const label = props.name.trim(); return <p>{label}</p> }",
      errors: [{ messageId: "eager" }],
    },
    {
      filename: "/repo/packages/editor-ui/src/Greeting.tsx",
      code: "const Greeting = ({ name }) => <p>{name}</p>",
      errors: [{ messageId: "destructure" }],
    },
  ],
});

tester.run("solid-v2-no-untracked-render-callback-read", solidV2NoUntrackedRenderCallbackRead, {
  valid: [
    {
      filename: "/repo/packages/editor-ui/src/List.tsx",
      code: 'import { Show, createMemo } from "solid-js"; <Show when={item()}>{item => { const label = createMemo(() => item().name); return <p>{label()}</p> }}</Show>',
    },
    {
      filename: "/repo/packages/editor-ui/src/List.tsx",
      code: "<For each={items()}>{item => { const label = () => props.format(item); return <p>{label()}</p> }}</For>",
    },
  ],
  invalid: [
    {
      filename: "/repo/packages/editor-ui/src/List.tsx",
      code: "<Show when={item()}>{item => { const label = item().name; return <p>{label}</p> }}</Show>",
      errors: [{ messageId: "untracked" }],
    },
    {
      filename: "/repo/packages/editor-ui/src/List.tsx",
      code: "<For each={items()}>{item => { const label = props.format(item); return <p>{label}</p> }}</For>",
      errors: [{ messageId: "untracked" }],
    },
  ],
});

tester.run("solid-v2-no-mirrored-derived-state", solidV2NoMirroredDerivedState, {
  valid: [
    {
      code: 'import { createMemo } from "solid-js"; const value = createMemo(() => props.value.trim())',
    },
  ],
  invalid: [
    {
      code: 'import { createEffect, createSignal } from "solid-js"; const [value, setValue] = createSignal(""); createEffect(() => props.value, value => setValue(value))',
      errors: [{ messageId: "mirrored" }],
    },
  ],
});

tester.run("no-effect-v3-api", noEffectV3Api, {
  valid: [
    {
      code: 'import { Effect } from "effect"; Effect.try({ try: () => work(), catch: error => error })',
    },
  ],
  invalid: [
    {
      code: 'import { Effect } from "effect"; Effect.catchAll(effect, recover)',
      errors: [{ messageId: "catchAll" }],
    },
    {
      code: 'import { Effect } from "effect"; Effect.try({ try: () => work() })',
      errors: [{ messageId: "tryCatch" }],
    },
  ],
});

tester.run("prefer-curried-layer-effect", preferCurriedLayerEffect, {
  valid: [{ code: 'import { Layer } from "effect"; Layer.effect(Service)(make)' }],
  invalid: [
    {
      code: 'import { Layer } from "effect"; Layer.effect(Service, make)',
      errors: [{ messageId: "curried" }],
    },
  ],
});

tester.run("no-unhandled-run-fork", noUnhandledRunFork, {
  valid: [
    {
      filename: "/repo/apps/playground/src/App.tsx",
      code: 'import { Effect } from "effect"; runFork(effect)',
      options: [["apps/playground"]],
    },
  ],
  invalid: [
    {
      filename: "/repo/apps/playground/src/App.tsx",
      code: 'import { Effect } from "effect"; Effect.runFork(effect)',
      options: [["apps/playground"]],
      errors: [{ messageId: "fork" }],
    },
  ],
});

tester.run("no-private-workspace-subpath-imports", noPrivateWorkspaceSubpathImports, {
  valid: [{ code: 'import { Graph } from "@macrograph/core"' }],
  invalid: [
    {
      code: 'import { Graph } from "@macrograph/core/src/Graph"',
      errors: [
        {
          messageId: "private",
          data: { specifier: "@macrograph/core/src/Graph" },
        },
      ],
    },
  ],
});

tester.run("no-schema-class-mutation", noSchemaClassMutation, {
  valid: [
    {
      filename: "/repo/packages/core/src/User.ts",
      code: 'import { Schema } from "effect"; class User extends Schema.Class<User>("User")({ name: Schema.String }) {}; const user = new User({ name: "old" }); const renamed = new User({ ...user, name: "new" })',
    },
  ],
  invalid: [
    {
      filename: "/repo/packages/core/src/User.ts",
      code: 'import { Schema } from "effect"; class User extends Schema.Class<User>("User")({ name: Schema.String }) {}; const user = new User({ name: "old" }); user.name = "new"',
      errors: [{ messageId: "mutation" }],
    },
  ],
});
