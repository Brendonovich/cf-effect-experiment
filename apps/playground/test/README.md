# Browser Regression

Run commands from the repository root with Node 22+ and the workspace dependencies installed (`pnpm install`). The browser script requires Playwright and its Chromium browser; Playwright is intentionally not a workspace dependency.

## Playwright Setup

If Playwright is already installed and resolvable from this script, no module override is needed. Otherwise, set `PLAYWRIGHT_MODULE` to the absolute path of an existing installation's `playwright/index.mjs`.

Alternatively, install an isolated copy without changing repository dependencies or the lockfile:

```sh
export PLAYWRIGHT_HOME="$(mktemp -d "${TMPDIR:-/tmp}/macrograph-playwright.XXXXXX")"
npm install --prefix "$PLAYWRIGHT_HOME" --no-save --package-lock=false playwright@1.62.1
node "$PLAYWRIGHT_HOME/node_modules/playwright/cli.js" install chromium
export PLAYWRIGHT_MODULE="$PLAYWRIGHT_HOME/node_modules/playwright/index.mjs"
```

For an existing installation without Chromium, run its adjacent `cli.js` with `install chromium` first.

## Run

Start an isolated playground server in one terminal:

```sh
pnpm --filter @macrograph/playground dev --host 127.0.0.1 --port 4315 --strictPort
```

In another terminal, with `PLAYWRIGHT_MODULE` exported if necessary:

```sh
node apps/playground/test/custom-types.browser.mjs
```

The default URL is `http://127.0.0.1:4315`. Override it with `PLAYGROUND_URL`; set `HEADED=1` to watch Chromium:

```sh
PLAYGROUND_URL=http://127.0.0.1:4315 HEADED=1 node apps/playground/test/custom-types.browser.mjs
```

The script uses a fresh browser context, so it does not replace your normal browser's project. Avoid concurrent source edits, formatting, or tests that write source files while it runs: Vite hot reload can reset the editor mid-scenario. Success prints `PASS`; failed assertions exit nonzero with diagnostic output.

## Coverage

- UI authoring of named structs and tagged enums, nested searchable Custom/List/Option/DateTime selection, and nominal identity preservation on rename.
- Structured nested defaults, saved values, explicit preview cancellation and confirmation, dependent type/node impacts, and stale-preview rejection after a concurrent node rename.
- List property descriptor selection, retained orphan defaults and stale pins/wires, explicit repair/removal, persistence reload, and mobile dependent type repair at 390x844.
- An imported deterministic execution graph using the UI-authored types: Make, per-field Update, Break, Construct, Match, Parse JSON, and Stringify JSON with nested DateTime preservation.
- Custom collection Create, Push, Insert, Set, Remove, Get, Random, Slice, Includes, and Length, including serialized Option outputs.
- Event replay, invalid reachable defaults blocking side effects, and restored types resuming execution; page errors and Solid strict-read warnings fail the run.

Runtime checks wait for logs or event diagnostics rather than fixed recording delays. Screenshots, videos, and final evidence capture are separate from this regression script.
