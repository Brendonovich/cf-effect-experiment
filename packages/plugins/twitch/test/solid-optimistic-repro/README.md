# Solid optimistic pending repro

This browser repro renders the Twitch connection control with two independent
accounts and the production state-reload staging logic.

Every simulated RPC and settings reload resolves after one second. The default
page preserves the buggy implementation, which marks only the optimistic state.
It allows a rapid connect to overlap disconnect and reproduces the storage race.

Open `?case=success` to render the current production `Settings` component. It
also marks the account, immediately disables the control, and prevents overlap.

Run from `packages/plugins/twitch`:

```sh
pnpm test:solid-repro
```

Open the printed URL and rapidly click disconnect then connect on either account.
The page does not perform any automatic interactions.

The source repro requires Vite because it compiles TSX and resolves workspace
packages. A production build can be hosted by any static HTTP server, but it
will not run directly from `file://`.
