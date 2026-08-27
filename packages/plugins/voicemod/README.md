# Voicemod

The standalone deployment connects to a configured local Voicemod Control API
URL, defaulting to `ws://127.0.0.1:59129/v1`. Supply your own client registration
key from Voicemod in settings, save, then click Connect. No hardcoded partner key
or automatic port scanning is included.

URLs must be credential-free `ws://` or `wss://` loopback URLs. `localhost` is
normalized to `127.0.0.1`; `[::1]` is also supported. Local means the server's
machine. The registration key is saved in server engine storage; settings
`ClientState` only indicates whether a key has been configured. Administrative
`GetProject` and project exports intentionally retain engine storage and can
include secrets; treat those project files as sensitive. Leaving the key field
blank keeps the existing key. Raw server error text is not exposed to clients.

Registration must return status code 200 before runtime actions become available.
The engine scope owns the connection, releasing it on disconnect, registration
failure, configuration changes, and engine shutdown. Disconnect can cancel
pending registration and runtime queries. Startup connection is optional, with
no automatic reconnect loops. Queries time out after 10 seconds.

## Catalog

| Schema ID              | Behavior                                                                          | Input                               |
| ---------------------- | --------------------------------------------------------------------------------- | ----------------------------------- |
| `SetVoice`             | Queries available voices, loads the selected voice and verifies the current voice | `voice`: ID or friendly-name string |
| `SetVoiceChangerState` | Queries live voice changer state, toggles only if needed, then verifies state     | `state`: boolean                    |
| `SetHearSelfState`     | Queries live hear-self state, toggles only if needed, then verifies state         | `state`: boolean                    |

All three reference actions are preserved. Actions fail when disconnected and
reject unavailable voices or invalid state responses instead of silently doing
nothing. Operations are serialized; neither setter relies on cached state.
External applications can still change state concurrently because the API only
offers toggles, not atomic setters. A failed verification is reported rather
than retried with another potentially incorrect toggle.

The [official API reference](https://control-api.voicemod.net/api-reference/)
documents null/missing response IDs and `toggleVoiceChanger` /
`toggleHearMyVoice` responses to status queries. The transport supports those
envelopes as well as the reference implementation's `payload`/`actionObject`
and `actionID`/`actionId` spellings. Only one query is outstanding; a canceled or
timed-out query closes the connection so a late ID-less reply cannot satisfy the
next query. Toggle commands consume their completion notification before a
verification query is sent, preventing an ID-less command notification from
satisfying that query and leaving its real response queued for the next setter.
Commands without response contracts use a subsequent status query.

There is no additional SDK dependency. The host provides Effect's injectable
`Socket.WebSocketConstructor`. Register `./Deployment` (also declared as
`macrograph.standaloneDeployment`) and `./Settings`. Tests use mocked WebSockets
and collect/run the full catalog without a Voicemod installation.
