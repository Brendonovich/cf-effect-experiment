# Browser playground boots

- **Feature ID:** `playground.boot`
- **Status:** Covered
- **Mode:** `smoke`
- **Command:** `pnpm verify:playground:smoke`

## User-visible contract

The real `@macrograph/playground` app starts on an isolated loopback port and renders the MacroGraph shell, Export action, and New graph action.

## Assertions and evidence

The harness waits for the branded shell and editor actions, rejects uncaught page errors and unexpected browser/network errors, and records `smoke.png`, `playground.log`, and their hashes in `manifest.json`. The optional OpenCode picker endpoint is explicitly marked as ignored when it is unavailable during standalone verification.
