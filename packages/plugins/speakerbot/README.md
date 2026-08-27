# SpeakerBot

Local-only, unauthenticated SpeakerBot WebSocket integration. Add the actual
SpeakerBot WebSocket URL in settings, connect it, and select that connection on
each node. The shared WebSocket settings form's initial URL is only an example;
SpeakerBot commonly uses `ws://127.0.0.1:7580`.

## Schemas

| ID             | Legacy Name              | Inputs                             |
| -------------- | ------------------------ | ---------------------------------- |
| `Speak`        | SpeakerBot Speak         | `voice`: string, `message`: string |
| `StopCurrent`  | SpeakerBot Stop Current  | None                               |
| `ToggleTTS`    | SpeakerBot Toggle TTS    | `state`: boolean                   |
| `EventsToggle` | SpeakerBot Events Toggle | `state`: boolean                   |
| `QueueToggle`  | SpeakerBot Queue Toggle  | `state`: boolean (queue paused)    |
| `QueueClear`   | SpeakerBot Queue Clear   | None                               |

All six legacy actions retain their exact wire payloads, including the legacy
`"Macrograph"` request ID. Success means the WebSocket writer accepted the
message, not that speech completed. SpeakerBot responses are not exposed as
graph events, matching the legacy action-only plugin. Disconnected, missing,
oversized-message and writer failures propagate from the transport.

The engine delegates the existing local WebSocket client implementation but
uses an independent engine/context, `SpeakerBotConnection` resource and
`SpeakerBot`-prefixed runtime/client RPCs. Settings bind to this plugin, not the
generic WebSocket plugin. Empty initial storage opens no sockets. No cloud
deployment or credential provider is configured.

Exports: plugin default, `Definition`, `Engine`, `Deployment`, and `Settings`
(named `settings`). Standalone discovery uses `./src/Deployment.ts`.

Runtime dependencies: `@macrograph/plugin`, `@macrograph/plugin-websocket-client`,
`effect`, `solid-js`, `@solidjs/web`. Tests use `@effect/vitest` and `vitest`.

Run `pnpm exec vitest run` in this package. Tests cover every outgoing payload,
both toggle states, propagated failures, and simultaneous mounting alongside
the generic WebSocket client with independent storage/sessions.
