# MacroGraph playground verification

This harness starts the real `@macrograph/playground` Vite app on an available loopback port and drives it through Chromium with Playwright. Every run uses a fresh temporary browser profile and removes that profile and its own app process on exit.

```sh
pnpm verify:doctor
pnpm verify:playground:smoke
pnpm verify:playground:journey
pnpm verify:playground
```

Evidence and `manifest.json` are written under `tools/verify-macrograph/artifacts/<run-id>/`. Set `MACROGRAPH_VERIFY_OUTPUT` for a different repository-relative or absolute directory, `MACROGRAPH_VERIFY_RUN_ID` for a stable run name, or `MACROGRAPH_VERIFY_HEADED=1` to watch the browser.

The initial journey creates and renames a graph through the UI, reloads the page to verify browser persistence, exports through the UI, resets the project, and imports the exported project again.

## Browser setup

Playwright is pinned at the repository root. Install its Chromium build once in a new environment:

```sh
pnpm exec playwright install chromium
```

CI installs Chromium and its Linux system dependencies before `check:ci`, then uploads the run manifest and evidence even when validation fails. `check:fast` does not invoke Playwright or download a browser.

Feature coverage is documented in `.opencode/skills/verify-macrograph/features/`. The machine-readable index remains in `feature-map.json`.

## Affected workspace packages

Use pnpm's workspace graph instead of maintaining a separate change mapper:

```sh
pnpm list:affected
pnpm test:affected
```

Both commands select packages changed since `origin/main` and their dependents. The real playground journey remains unconditional in CI because it is inexpensive and package-level impact cannot determine which product journey changed.
