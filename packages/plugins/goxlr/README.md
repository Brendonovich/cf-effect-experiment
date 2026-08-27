# GoXLR

Local-only, unauthenticated GoXLR Utility daemon integration. Configure the
daemon's actual WebSocket address, commonly
`ws://127.0.0.1:14564/api/websocket`, connect it, and select its connection on
each node. The reused WebSocket settings form's initial URL is only an example.

## Schemas

| ID                  | Legacy Name         | Inputs/Outputs                                      |
| ------------------- | ------------------- | --------------------------------------------------- |
| `MuteSlider`        | Mute Slider         | `Slider`: string, `muteState`: boolean              |
| `SetMicrophoneType` | Set Microphone Type | `micType`: string                                   |
| `SetReverbAmount`   | Set Reverb Amount   | `amount`: integer                                   |
| `SetEchoAmount`     | Set Echo Amount     | `amount`: integer                                   |
| `SetPitchAmount`    | Set Pitch Amount    | `amount`: integer                                   |
| `SetGenderAmount`   | Set Gender Amount   | `amount`: integer                                   |
| `SetFXState`        | Set FX State        | `state`: boolean                                    |
| `SetFXPreset`       | Set FX Preset       | `preset`: string                                    |
| `SetRouteState`     | Set Route State     | `input`: string, `output`: string, `state`: boolean |
| `LevelChange`       | Level Change        | Outputs `channel`: string, `value`: integer         |
| `ButtonState`       | Button State        | Outputs `buttonName`: string, `state`: boolean      |
| `DialState`         | Dial State          | Outputs `dial`: string, `amount`: integer           |
| `ChannelMuteState`  | Channel Mute State  | Outputs `channel`: string, `state`: boolean         |

All 13 legacy schemas are implemented. Legacy enum inputs become validated,
case-sensitive strings because the current graph DataType has no enum type:

- Sliders: `A`, `B`, `C`, `D`.
- Microphone types: `Dynamic`, `Condenser`, `Jack`.
- Presets: `Preset1` through `Preset6`.
- Inputs: `Microphone`, `Chat`, `Music`, `Game`, `Console`, `LineIn`, `System`, `Samples`.
- Outputs: `Headphones`, `BroadcastMix`, `LineOut`, `ChatMic`, `Sampler`.

Amounts retain legacy integer semantics; the daemon validates device-specific
ranges. No structured graph outputs are required by these legacy schemas.

## Protocol

The dedicated Effect Socket engine requests `GetStatus` on open and waits for
a valid status before marking a connection connected. Commands select the first
available mixer from that connection's status. Status and mixer-roster
add/replace/remove patches maintain the selection; missing mixers fail commands.

Commands preserve the exact legacy `id: 0` envelope. Each connection serializes
commands and waits for its daemon `Ok` acknowledgment. Daemon errors, writer
errors, connection closure, and 10-second status/command-exchange timeouts fail
instead of reporting success. Failed command exchanges close the socket to
prevent late id-zero replies from acknowledging later commands.

The command timeout covers both writing and acknowledgment, including a blocked
writer. Connection setup is engine-owned: cancelling an RPC waiter does not
cancel setup or other waiters. Setup still reaches connected/error state on a
late handshake, closure or timeout; explicit disconnect/remove closes it.

Inbound messages are size-limited, text-only and validated. Malformed messages
are logged and dropped. Broadcast patch envelopes accept the daemon's
`18446744073709551615` sentinel; only exact numeric request ID `0` acknowledges
commands. Scalar patch events accept only add/replace operations
for the selected mixer, validate values, round numeric values, and decode JSON
Pointer escapes. Numeric values that cannot round to safe integers are dropped,
and dial events require `effects/current/<dial>/amount` paths.
Unsupported/test/remove/move/copy scalar patches do not emit
events and do not truncate the rest of a patch batch. Channel mute events also
adapt actual daemon `mute_state` strings/objects to booleans, in addition to
legacy boolean values.

The plugin has independent engine/context keys, a `GoXLRConnection` resource,
`GoXLR`-prefixed client RPCs, and `GoXLRCommand` runtime RPC. Settings bind to this
plugin. Empty initial storage opens no sockets. Saved connection intent is
honored, but disconnect disables it. No cloud deployment is provided.

Exports: plugin default, `Definition`, `Engine`, `Deployment`, and `Settings`
(named `settings`). Standalone discovery uses `./src/Deployment.ts`.

Runtime dependencies: `@macrograph/plugin`, `@macrograph/plugin-websocket-client`
(settings, connection schemas and local URL policy), `effect`, `solid-js`,
`@solidjs/web`. Tests use `@effect/vitest` and `vitest`.

Run `pnpm exec vitest run` in this package. Tests cover exact outgoing commands,
enum validation, inbound parsing/filtering, status discovery, mixer changes,
startup/idle behavior, reconnects, URL validation, missing mixers/connections,
daemon/writer failures and both timeout paths. Hardware testing is still needed.
