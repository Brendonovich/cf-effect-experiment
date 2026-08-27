# VTube Studio

The standalone deployment runs the VTube Studio Public API WebSocket protocol on
the server. Enable VTube Studio's API, save a local URL in settings, click Connect,
and approve MacroGraph's authentication prompt. One instance is configured per
project; nodes select it through the VTube Studio Instance resource.

Only credential-free `ws://` and `wss://` loopback URLs are accepted. `localhost`
is normalized to `127.0.0.1` to avoid DNS resolution; IPv6 `[::1]` is also supported.
Local means the server's machine, not the browser's. No cloud relay is provided.

Approved authentication tokens are persisted in server engine storage and omitted
from settings `ClientState`. Administrative `GetProject` and project exports
intentionally retain engine storage and can include secrets; treat those project
files as sensitive. Changing the URL clears the token. Reset Authentication
clears a revoked token so the next connection can request approval again. Server
protocol error text is not forwarded, preventing accidental secret disclosure.

Connections belong to the engine scope and are released on disconnect, failed
authentication, configuration changes, and engine shutdown. Disconnect also
cancels pending approval. Optional startup connection is supported; there are no
background reconnect loops. Requests time out after 30 seconds.

## Catalog

| Schema ID          | Protocol Request        | Pins                                              |
| ------------------ | ----------------------- | ------------------------------------------------- |
| `AvailableModels`  | `AvailableModels`       | `models`: JSON array string                       |
| `LoadModel`        | `ModelLoad`             | `model`: modelID string                           |
| `ExpressionState`  | `ExpressionState`       | `expressions`: JSON array string                  |
| `ToggleExpression` | `ExpressionActivation`  | `file`: expression file string; `active`: boolean |
| `GetHotkeyList`    | `HotkeysInCurrentModel` | `hotkeys`: JSON array string                      |
| `ExecuteHotkey`    | `HotkeyTrigger`         | `id`: hotkeyID string                             |

All six reference actions are preserved. Without runtime structs/enums or dynamic
suggestions, list outputs contain the original API objects as JSON. Hotkey
objects retain `hotkeyID` rather than the old struct's renamed `id` field. Model,
expression and hotkey selections use string pins, not client SDK objects.

The package uses Effect's injectable `Socket.WebSocketConstructor`, not an SDK
dependency. Export `./Deployment` (also `macrograph.standaloneDeployment`) and
`./Settings` for host registration. Tests use mocked WebSockets and collect/run
the complete catalog without requiring VTube Studio.
