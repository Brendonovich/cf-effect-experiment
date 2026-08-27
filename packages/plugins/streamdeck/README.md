# Stream Deck WebSocket

Local-only integration for the legacy MacroGraph Stream Deck WebSocket bridge.
This is not a Stream Deck SDK plugin. Configure the bridge to connect to the
listener and select that listener on each event node.

Settings offer **Add Stream Deck Listener (1880)**, which creates a loopback
listener with the legacy default port `1880`. Click **Start** to bind it. The
reused WebSocket server settings also support explicit custom hosts and ports;
their generic add form initially shows port `1890`. No listener starts from
empty initial storage, and bind failures remain visible rather than succeeding.

## Schemas

| ID        | Legacy Name          | Outputs               |
| --------- | -------------------- | --------------------- |
| `KeyDown` | Stream Deck Key Down | `id`: string (Key ID) |
| `KeyUp`   | Stream Deck Key Up   | `id`: string (Key ID) |

Both legacy schemas are implemented without structured-output adaptations.
Inbound JSON must contain `event: "keyDown" | "keyUp"` and the legacy `payload`
shape: numeric `coordinates.column`/`coordinates.row`, boolean
`isInMultiAction`, and string `settings.id`/`settings.remoteServer`. Malformed or
unknown messages are logged and dropped without breaking subsequent events.

Only the first connected client for each configured listener supplies events,
matching the legacy bridge. Its disconnection clears the selection; a newly
connected client can then become active. Existing ignored clients must reconnect.
Events are additionally filtered by the node's selected listener. No outgoing
commands exist in the legacy plugin.

The engine delegates the existing WebSocket server transport and Node listener,
but has independent engine/context keys, a `StreamDeckServer` resource and
`StreamDeck`-prefixed client RPCs. Settings bind to this plugin rather than the
generic server plugin. The protocol has no authentication; loopback binding is
recommended. No cloud deployment is provided.

Exports: plugin default, `Definition`, `Engine`, `Deployment`, and `Settings`
(named `settings`). Standalone discovery uses `./src/Deployment.ts`.

Runtime dependencies: `@macrograph/plugin`, `@macrograph/plugin-websocket-server`,
`effect`, `solid-js`, `@solidjs/web`. Tests use `@effect/vitest` and `vitest`.

Run `pnpm exec vitest run` in this package. Tests cover key output/filtering,
per-listener client selection, malformed-message recovery, management RPC
delegation, listener failure propagation and the default port.
