# @macrograph/vite-shared-libraries

Build tooling that lets separately built module UI share library instances and StyleX tokens with a host app.

## Shared libraries (`sharedLibraries()`)

`sharedLibraries(options?)` is a Vite plugin for host apps, used by `apps/server/client`.

- **Expansion.** It expands `SharedLibraries.browser` from `@macrograph/module/SharedLibraries` using each package's real `exports` field. Wildcard export keys are expanded against the files on disk. It skips subpaths under an `internal` segment produced by wildcards, non-script targets (`package.json`, CSS) and `SharedLibraries.browserExcluded`. Packages are located from the app root first, then from the other shared packages, so `@tanstack/solid-query` is found through `@macrograph/editor-ui`.
- **Production build.** Every shared specifier's resolved module is emitted as its own entry chunk at `<base>_shared/<hash>/<specifier>.js`, with `preserveSignature: "strict"`, so all exports are kept. Specifiers that resolve to the same module share a chunk. The host's own imports resolve to the same modules, so the page has exactly one instance of each library. Internal chunks stay under `assets/`.
- **Import map.** An inline `<script type="importmap">` is injected at the top of `<head>`, before the entry script and any module preloads.
- **Build manifest.** The plugin writes `<outDir>/.macrograph/shared-libraries.json` (`BuildManifest.Model`): the import map, `scriptSrc` with its CSP hash (`'sha256-…'`) and the list of shared files. The dot directory is never served. `apps/server/src/ClientBuildManifest.ts` reads `scriptSrc` into the CSP `script-src`.
- **Dev mode.** By default the plugin injects an import map that points at Vite's pre-bundled dependencies (`/node_modules/.vite/deps/x.js?v=<browserHash>`, the same URLs Vite rewrites host imports to) and at linked workspace sources (`/@fs/...`). It only covers dependencies the optimizer has already discovered, which in practice means after the first load or optimizer reload. Undiscovered `node_modules` dependencies are left out on purpose: resolving them would register them with the optimizer and trigger a reload. A prebuilt module importing a shared subpath the host never uses gets a clear "unmapped specifier" error instead of a duplicate instance. Workspace sources edited through HMR get a `?t=` query on the host side, so the host and a prebuilt module can drift until a reload. Built-ins in dev should use Vite source URLs instead (spec section 9). Disable the dev import map with `devImportMap: false`.

## StyleX (`stylexOptions()`, `layerAnchors()`)

Every StyleX config in the repo uses:

```ts
import stylex from "@stylexjs/unplugin";
import { layerAnchors, stylexOptions } from "@macrograph/vite-shared-libraries/StyleX";

plugins: [layerAnchors(), stylex.vite(stylexOptions()), solid()];
```

- **Token names don't depend on where files are.** `unstable_moduleResolution` is `{ type: "custom" }`. A theme file is named by the public specifier that exports it, such as `@macrograph/editor-ui/tokens.stylex`, falling back to `<package>:<path without extension>`. A module built outside the monorepo against a published `@macrograph/editor-ui` with a different file layout (for example `dist/tokens.stylex.js`) derives the same `defineVars`, `defineConsts` and `defineMarker` names as the host. StyleX's `haste` mode doesn't work here: it hashes the raw import string plus the importing file's extension. The previous `commonJS` mode hashed `<package>:<relative path with extension>`, which breaks as soon as the published layout differs.
- **Layer order across stylesheets.** StyleX names its `stylex.priorityN` layers by position among the priority levels present in one stylesheet, not by the level itself. A module stylesheet with fewer levels than the host would put its rules into layers that mean a lower priority in the host. For example, a module's `paddingTop` could lose to the host's `paddingBlock`. `layerAnchors()` adds a file of never-applied rules covering levels 0–9 to every build that imports `@stylexjs/stylex`, so the layer names line up. The host's stylesheet loads first and declares the order. Place `layerAnchors()` before the StyleX plugin.

## Notes for module builds (W5)

- Use `stylexOptions()` and `layerAnchors()`, and keep every `SharedLibraries.isShared(id, "browser")` import external.
- `@stylexjs/unplugin` keeps rules in a process-global store (`globalThis.__stylex_unplugin_store`) that `buildStart` doesn't clear. Building several modules in one process leaks rules between their stylesheets, so build each module in its own process or clear the store between builds.
- When a library-mode build has no CSS asset, StyleX writes `assets/stylex.css` in `writeBundle`, outside the Rollup bundle. Import a CSS file from the entry, or locate the file after the build.
