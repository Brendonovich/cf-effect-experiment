# @macrograph/module-build

Build preset and `macrograph-module` CLI that turn a module's source package into a module
package folder (see `@macrograph/module/ModulePackage`):

```text
macrograph.json   generated from package.json "macrograph", validated with Manifest.decode
server.cjs        one function-wrapped CommonJS file for vm.compileFunction(code, ["require", "module", "exports"])
ui/index.js       ESM UI entry, default export ModuleUI.make({ settings })
ui/*.js           UI chunks
ui/styles.css     extracted CSS (StyleX included, no runtime injection)
assets/           icon
```

## package.json

```json
{
  "macrograph": {
    "publisher": "macrograph",
    "name": "twitch",
    "version": "0.1.0",
    "api": 1,
    "displayName": "Twitch",
    "description": "…",
    "entries": { "server": "./src/Deployment/WebSocket.ts", "ui": "./src/UI.ts" },
    "icon": "./icon.svg",
    "requires": ["http-client", "socket"],
    "node": ["crypto"],
    "build": { "external": [] }
  }
}
```

- `entries.server` default-exports the deployment, or the bare module when it has no engine.
- `entries.ui` default-exports `ModuleUI.make({ settings })`.
- `node` lists the `node:*` built-ins the bundled server code requires; the build fails when a
  required built-in is undeclared.
- `build.external` keeps extra specifiers as `require(...)` calls. The host's injected `require`
  must resolve them or they throw (used by MIDI for its native addon).

## Server bundle

Rolldown, `platform: "node"`, CommonJS, one chunk with dynamic imports inlined. Shared server
specifiers (`SharedLibraries.isShared(spec, "server")`) and Node built-ins (normalised to
`node:*`) stay as `require` calls; everything else is bundled. Optional `require`s of packages
that can't be resolved become stubs that throw `Cannot find module`. Top-level await fails the
build.

## Checks

`Checks` is platform-neutral (no Node APIs) so the registry can run it on uploaded packages:

- `checkPackage(files, { limits, external, supportedApis })`: manifest, layout, referenced
  files, server entry, UI chunks, size limits.
- `analyzeServerEntry` / `checkServerEntry`: syntax, top-level await, requires the host can't
  resolve, undeclared `node:*` built-ins, bundled shared libraries.
- `checkUiChunk`: bare imports outside the shared browser set, bundled shared libraries.
- `sharedLibraryCopies(modules, target)`: the same check on a bundle graph; the build runs it on
  Rolldown's module ids with package names read from each file's nearest `package.json`.

## CLI

```sh
macrograph-module build [dir] [-o out]
macrograph-module dev [dir] --target <local modules dir> [--watch]
macrograph-module package [dirs…] --dependencies-of <dir> --out <dir> [--namespace ns]
macrograph-module publish   # not implemented yet
```

`apps/server` runs `pnpm build:modules` to package its module dependencies into
`dist/modules/<namespace>/<publisher>/<name>/<version>/`.

## UI bundle

Vite library build (`src/UiBuild.ts`) with the host's canonical StyleX settings from
`@macrograph/vite-shared-libraries/StyleX`: `layerAnchors()` before `stylex.vite(stylexOptions())`,
so token variable names and `stylex.priorityN` layers match the host's stylesheet. Every
`SharedLibraries.isShared(id, "browser")` import stays a bare external import that the host's
import map resolves. All CSS, StyleX included, goes into `ui/styles.css`; nothing is written
outside `ui/`.

`@stylexjs/unplugin` keeps its rules in a global store that survives between builds, so each
module's UI is built in its own worker thread (`UiBuild.isolated`). `buildTree`, `package` and
the other CLI commands never mix one module's rules into another's stylesheet. `UiBuild.run`
builds in the current thread.
