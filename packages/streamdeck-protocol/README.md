# `@macrograph/streamdeck-protocol`

The wire protocol between MacroGraph and the **external** Stream Deck plugin
relay (`.sdPlugin`). The relay is built in a separate repo and depends on this
package for the message shapes and version constants. MacroGraph only speaks
this protocol — the legacy `keyDown`/`keyUp` JS bridge is gone.

## Architecture

Two connections, with the plugin acting as the relay hub:

```
Stream Deck app ⇢(Elgato SDK, ws://127.0.0.1:3366)⇠ Stream Deck plugin
Stream Deck plugin ⇢(this bridge, ws://127.0.0.1:1880)⇠ MacroGraph
```

MacroGraph runs a WebSocket **server** (the plugin's "Stream Deck Listener",
default port `1880`). The plugin connects out to it.

## Handshake

On bridge open, the plugin sends:

```json
{ "type": "hello", "version": 1, "client": "macrograph-streamdeck", "pluginUuid": "..." }
```

If `version !== 1` or the client id does not match, MacroGraph drops the
connection. Otherwise it replies:

```json
{ "type": "helloAck", "version": 1 }
```

After `helloAck`, the plugin **replays** the current live state so MacroGraph
rebuilds its bindings:

1. `deviceConnected` for every connected device, then
2. `appear` for every placed action instance (including its `settings`, which
   carry the `mgButtonId` binding).

There is no aggregate sync message — the individual replay above is sufficient.
The `hello` / `deviceConnected` / `appear` sequence arrives naturally from the
Stream Deck SDK on plugin registration, so the plugin simply caches these
until the bridge is connected and flushes them on `helloAck` (and on reconnect).

## Binding (`mgButtonId`)

The per-key profile `settings` object (which the plugin persists in the app's
per-key settings via `setSettings`) stores the binding:

```ts
export const BUTTON_SETTING_KEY = "mgButtonId";
```

- A non-empty string button id ⇒ the key is bound to that MacroGraph button
  definition.
- Absent or empty ⇒ unbound; the key is ignored.

The plugin's property inspector loads button definitions via `queryButtons`
and writes the chosen id into `settings.mgButtonId`. After that, the macro
graph sends `settingsChanged` on `didReceiveSettings`, and MacroGraph updates
its live binding map.

## Messages

Full TypeScript shapes + zero-dependency builders in `src/index.ts`. Effect
`Schema` wrappers in `src/schema.ts` (only used by MacroGraph).

### Plugin → MacroGraph

| `type`                    | Purpose                                              |
| ------------------------- | ---------------------------------------------------- |
| `hello`                   | Bridge handshake                                     |
| `deviceConnected`         | A Stream Deck device was discovered                  |
| `deviceDisconnected`      | A device was removed                                 |
| `appear`                  | An action instance was placed on a key               |
| `disappear`               | An action instance left a key                        |
| `keyDown` / `keyUp`       | A key was pressed / released (arbitrary `payload`)   |
| `settingsChanged`         | The key's profile settings changed (`didReceiveSettings`) |
| `globalSettingsChanged`   | Plugin global settings changed                       |
| `fromPropertyInspector`   | Property inspector → plugin message being forwarded  |
| `queryButtons`            | Request the current button definitions (for the PI)  |

### MacroGraph → plugin

| `type`                    | Stream Deck SDK call                 |
| ------------------------- | ------------------------------------ |
| `helloAck`                | —                                    |
| `setTitle`                | `setTitle(context, title, state)`    |
| `setImage`                | `setImage(context, image, state)`    |
| `setState`                | `setState(context, state)`           |
| `showOk`                  | `showOk(context)`                    |
| `showAlert`               | `showAlert(context)`                 |
| `setSettings`             | `setSettings(context, settings)`     |
| `setProfile`              | `setProfile(deviceId, profile)`      |
| `switchToProfile`         | `switchToProfile(deviceId, profile)` |
| `sendToPropertyInspector` | `sendToPropertyInspector(action, context, payload)` |
| `openUrl`                 | `openUrl(url)`                       |
| `buttonList`              | Reply to `queryButtons`              |

## Consuming from the external plugin repo

The package is source-transpiled (consistent with MacroGraph's own packages):
`exports` point at `.ts` files. Reference it from the plugin repo and compile
with a bundler/TS that resolves TypeScript sources (the MacroGraph stack uses
`tsgo` + rolldown/vite; the same tooling works for the Node plugin).

```sh
pnpm add @macrograph/streamdeck-protocol
# or a git dependency on the MacroGraph repo
```

```ts
import { hello, setTitle, PROTOCOL_VERSION } from "@macrograph/streamdeck-protocol";
// Wire draft (Node `ws`):
//   ws.send(JSON.stringify(hello(pluginUuid)))
// validate inbound with your own decoder against `PluginMessage`/`MasterMessage`
```