# Electron Catalog Coverage

Reference: jdudetv's `ELECTRON` branch in `brendonovich/macrograph`, commit
`adbf262a510798c95892283d6d28a64ce7277e63` ("maybe electron owo"). The audit covers
every export in `packages/packages/src/index.tsx`, its supporting transports, and
the JSON, Option, and Utils libraries. This is not an audit of the reference's
current main branch.

The reference defines 42 packages: 38 with graph nodes and four OAuth settings
shells. Expanding generated keyboard nodes gives 670 schema declarations, but
669 effective registrations because Twitch overwrites one duplicate name. Four
are internal Function/Queue schemas. Counts describe source surfaces, not proof
that every legacy node works, and are not a requirement to copy every menu entry.

## Runtime Strategy

New Elgato Key Light, LIFX, IKEA, and TikTok packages use real
server-side HTTP, UDP/DTLS, or service transports, not `window.electronAPI` stubs.
The self-hosted server discovers their deployments and settings in both development
and production. Native/device integrations are not mounted in browser or
Cloudflare runtimes. Existing portable JSON, List, Logic, Utilities, HTTP, and OBS
catalogs retain their existing host registrations.

LIFX uses the workspace [`effect-node-udp`](../effect-node-udp/README.md) transport.
IKEA layers its CoAP exchanges over [`effect-node-dtls`](../effect-node-dtls/README.md),
which uses the same UDP transport. Socket ownership,
receive buffering, and cancellation live in the transport packages; device packet
correlation remains in the plugins. See those package READMEs for protocol limits
and verification requirements.

The current graph type system supports scalar, DateTime, List, and Option values,
but not native Map/Struct/Enum/wildcard types. Structured integration values use
JSON text. List and Logic helpers select explicit element types. This is an
adaptation to the current runtime, not automatic migration of legacy graphs.

## Added Coverage

The current package-source catalog grows from 23 plugins / 426 schemas to
27 plugins / 520 schemas: **four new plugins and 94 additional nodes**.

| Change                                     | Additional Nodes |
| ------------------------------------------ | ---------------: |
| Elgato Key Light                           |               10 |
| IKEA TRADFRI Gateway                       |                6 |
| LIFX LAN                                   |                6 |
| TikTok (Euler Stream)                      |               19 |
| Twitch actions                             |               30 |
| OBS requests, events, and color conversion |               11 |
| HTTP URL helpers                           |                2 |
| Filesystem text reads/writes               |                2 |
| JSON object operations                     |                6 |
| List random selection                      |                1 |
| Utilities time formatting                  |                1 |

Existing nodes also gain HTTP request/response body and header IO, optional OBS
canvas UUIDs on 36 requests, Twitch reply/slow/follower-duration inputs, logger
severity selection, and typed scalar-list Cache/Copy. New device/service settings
and OBS high-volume subscription controls are available in the editor. The count
includes Ko-fi, which is not mounted on the standalone server. It is not a legacy
parity percentage; several representations are adapted and some nodes are extras.

## Complete Inventory

"Covered" below means there is a functioning current counterpart for the node
family, not identical legacy pin shapes, authentication, execution location, or
streaming semantics. See each plugin README for exact current schemas and limits.

| Electron Package        | Source Nodes | Current Coverage                                                                                                                                                                |
| ----------------------- | -----------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audio                   |            5 | Deferred: playback, device selection, file references, and stopped events need an audio capability bridge.                                                                      |
| Custom Events           |            2 | Deferred: project-defined event registry and dynamic typed fields.                                                                                                              |
| Discord                 |            6 | Existing event, messaging, lookup, and webhook nodes; file attachments and upload progress remain absent.                                                                       |
| ElevenLabs              |            1 | Existing TTS; audio is returned encoded, not written to an Electron-selected file.                                                                                              |
| Filesystem              |            4 | Listing plus added UTF-8 read/write nodes. Writes require host opt-in.                                                                                                          |
| GitHub                  |            0 | OAuth settings shell only; no graph nodes to port.                                                                                                                              |
| Google                  |            0 | OAuth settings shell only; no graph nodes to port.                                                                                                                              |
| Patreon                 |            0 | OAuth settings shell only; no graph nodes to port.                                                                                                                              |
| Spotify                 |            0 | OAuth settings shell only; no graph nodes to port.                                                                                                                              |
| Global Mouse & Keyboard |           55 | Deferred: global hooks/emulation and key state need a desktop capability bridge.                                                                                                |
| HTTP Requests           |            7 | Existing methods expanded with request/response IO and URL helpers. GET File awaits a download/artifact strategy.                                                               |
| Keyboard Inputs         |           52 | Deferred: browser/window events and pressed-key state need an explicit execution location.                                                                                      |
| GoXLR                   |           13 | Existing mixer controls and status events; validated string inputs replace enums.                                                                                               |
| List                    |            8 | All eight source operations covered, including added execution-time random selection; element types are explicit scalars.                                                       |
| Localstorage            |            5 | Deferred: the source uses browser-origin `value-` keys, not project-scoped server storage.                                                                                      |
| Logic                   |           13 | Boolean/routing/waiting nodes covered; For Each, For Loop, and While require scope execution support.                                                                           |
| Map                     |           11 | JSON object creation/editing/lookup/membership/keys/values/size/removal substitutes; no native typed Map pins.                                                                  |
| MIDI                    |           13 | Deferred: seven receive/six send nodes need device discovery and an input/output capability bridge.                                                                             |
| OBS Websocket           |          180 | Existing broad request/event catalog expanded for Electron gaps; version and high-frequency-event limits are documented by OBS.                                                 |
| OpenAI                  |            2 | Existing chat/image nodes; chat is non-streaming with JSON history, not scoped streaming execution.                                                                             |
| Shell                   |            1 | Existing opt-in host shell; PowerShell/cmd/pwsh engine selection remains absent.                                                                                                |
| SpeakerBot              |            6 | Existing speech and queue controls. Source has no SpeakerBot graph event nodes.                                                                                                 |
| Stream Deck WebSocket   |            2 | Existing key-down/up events through a forwarder/listener.                                                                                                                       |
| Streamlabs              |            5 | Existing donation and YouTube membership/superchat events.                                                                                                                      |
| Twitch Events           |          105 | Actions expanded; EventSub parity and rich event-specific IO remain partial. Source intended 106 nodes before its collision.                                                    |
| Utils                   |           89 | Distributed across Math/String/Logic/List/JSON/Utilities; adds Format Time, logger severity, and list Cache/Copy. Advanced type/scope/startup/custom-event nodes remain absent. |
| VTube Studio            |            6 | Existing model/expression/hotkey controls with JSON structures and live suggestions.                                                                                            |
| Websocket Client        |            2 | Existing send/receive; resources replace dynamic URL/name routing, and event URL provenance remains absent.                                                                     |
| WebSocket Server        |            4 | Existing connect/disconnect/receive/send/broadcast; selected server resources replace dynamic port routing.                                                                     |
| Queue                   |            8 | Deferred: dedicated queue graphs, typed entries, pause/advance/iteration, and two internal execution schemas.                                                                   |
| Function Queue          |            6 | Deferred: selected functions and typed return values require function execution/domain models.                                                                                  |
| TikTok (Euler Stream)    |            6 | Added 19 event nodes including the source's six categories; provider transport differences are explicit in its README.                                                          |
| Variables               |            6 | Deferred: typed persisted graph/project definitions, changed events, and function-local scopes.                                                                                 |
| Voicemod                |            3 | Existing voice/changer/hear-self controls; configured registration key replaces embedded legacy credentials.                                                                    |
| Functions               |            3 | Deferred: reusable typed function graphs and nested execution, including two internal schemas.                                                                                  |
| Script                  |            1 | Deferred: script resources, typed IO, async execution, TypeScript tooling, and a safe isolated execution strategy.                                                              |
| IKEA                    |            7 | Added TRADFRI gateway integration, not a generic DIRIGERA/all-IKEA-products adapter. See package README for observation support.                                                |
| LIFX                    |            8 | Added six control/conversion nodes using manually configured LAN devices; discovery and discovered events deferred.                                                             |
| Elgato Key Light        |            8 | Added ten control/conversion nodes using manual HTTP origins; discovery and discovered events deferred.                                                                         |
| Speech to Text          |            3 | Deferred: microphone/16 kHz worklet capture, native Whisper inference, verified model downloads, and CPU/CUDA selection.                                                        |
| Zigbee2MQTT             |            4 | Intentionally excluded at the user's request; no plugin or host wiring is included.                                                                                             |
| JSON                    |            9 | Typed JSON-text conversions/query/extraction and added immutable object helpers; no JSON enum/Map representation.                                                               |

Ko-fi already exists in the current version but is outside this Electron export
catalog. Option and the Utils support library define no graph nodes: Effect Option
replaces the former, and the latter is only a one-promise cache helper. Host-mirror,
HTTP endpoint, path, socket-adapter, and Script tooling modules are supporting
capabilities, not additional plugin menus.

## Remaining Work

- Device/browser capabilities: Audio, Keyboard, global input, MIDI, Speech to Text,
  and browser-origin Localstorage. Do not silently substitute the server's devices
  or project database for the editor user's devices/storage.
- Project domains: typed custom events, variables, functions, queues, function
  queues, startup events, and named return-event execution.
- Type/execution extensions: native Map/Struct/Enum/wildcards, composite builders,
  Match/Break Scope, and scope-based loops. JSON substitutes do not implement these.
- Twitch EventSub: remaining reward/redemption, follow/whisper, goal, stream,
  shield, AutoMod, Guest Star, bits/moderation, and power-up families require
  versioned definitions, scopes/conditions, decoding, and both deployment transports.
  Existing event families also need richer polls/predictions/contributions/chat IO.
- Artifacts and transport details: guarded HTTP downloads, Discord attachments,
  ElevenLabs file output, OpenAI streaming scopes, shell-engine selection, and
  WebSocket provenance/dynamic routing.
- Explicit discovery policies for LIFX and Key Light. Configured devices are not
  fabricated as discovery events. Native device/provider reliability still needs
  testing against physical devices and live accounts.
- IKEA Light State Changed requires CoAP Observe sequencing, cancellation,
  resubscription, and reconnect reconciliation. Only its six action nodes are
  registered; no fake state-change event or background polling is included.

## Source Defects

Do not reproduce the following defects merely to match the reference:

- Two Twitch update events use `Channel Point Reward Updated`; the later one
  overwrites the earlier. Future ports must use distinct identifiers.
- The legacy HTTP PUT node sends POST.
- LIFX and Key Light define Device Discovered nodes, but their contexts never
  emit that event. LIFX emits state changes without defining a matching node.
- Zigbee settings reference an Electron bridge absent from this revision's
  preload/main implementation; embedded process management is not proven parity.
- MIDI Program Change incorrectly requires three bytes; Pitch Bend sending omits
  a data byte; receive nodes omit channel/note outputs.
- Audio's backend ignores Play's initial volume; OBS's legacy Toggle Output node
  actually requests stream status.
- Script executes unrestricted `new Function`; STT model hashes must be verified
  before adopting its downloader in production.

## Verification And Trust

Plugin tests use mocked providers/transports and, for LAN protocols where practical,
loopback fixtures. Shared server tests mount catalogs, engines, resources, and RPCs
together without configuration. Builds/typechecks and browser settings checks do
not replace live hardware/provider validation.

Only trusted authors should configure or run host-capable graphs. Device addresses
are reached from the server. Filesystem reads use server permissions, and writes
require `MACROGRAPH_ENABLE_FILE_WRITES=true`. Secrets stay out of plugin client
state but may exist in project databases, administrative exports, and backups.
Protect those locations and review third-party service requirements and dependency
licenses, particularly TikTok's unofficial connector, before redistribution.
