# Stream Deck

Native Elgato Stream Deck integration for MacroGraph. MacroGraph hosts a local
WebSocket listener; an external `.sdPlugin` (separate repo) connects out and
relays the Stream Deck SDK over `@macrograph/streamdeck-protocol`.

This is **not** the legacy keyDown/keyUp JS bridge. The old protocol is gone.

## Setup

1. Open a project — the engine **auto-seeds and starts** a listener on
   `0.0.0.0:1880` (no Settings host/port UI).
2. Create **Buttons** in Stream Deck settings. They persist with the project.
3. Install the MacroGraph Stream Deck plugin and drag **MacroGraph Button** onto a key.
4. In the property inspector, pick a MacroGraph button. That writes `mgButtonId`
   into the key's Stream Deck settings.

Live bindings are runtime-only and rebuild when the plugin reconnects (via
`deviceConnected` + `appear` replay after `hello`/`helloAck`).

## Schemas

| ID               | Type   | Purpose |
| ---------------- | ------ | ------- |
| `KeyDown` / `KeyUp` | event  | Emit **State** (bool) from the key’s current icon state — wire through **NOT** into **Set Button State** to toggle. |
| `SetButtonState`    | action | Set on/off from a bool |
| `SetButtonTitle` | action | Set the text on the key |

Outbound commands to unbound buttons log a warning and succeed.

## Resources

- `StreamDeckServer` — auto-managed bridge listener
- `StreamDeckButton` — project button definitions (persisted)
- `StreamDeckDevice` — connected devices reported by the plugin

## Protocol

Wire shapes live in `@macrograph/streamdeck-protocol`. Handshake requires
`version === 1` and `client === "macrograph-streamdeck"`.

Exports: plugin default, `Definition`, `Engine`, `Deployment`, and `Settings`
(named `settings`). Standalone discovery uses `./src/Deployment.ts`.

Run `pnpm exec vitest run` in this package.
