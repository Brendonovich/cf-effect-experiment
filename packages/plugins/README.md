# Plugin ports

The self-hosted server includes the runtime-compatible ports from the older
MacroGraph `packages/packages` catalog, alongside the plugins already ported from
`base-packages`. Configuration is project-scoped and applies to the running engine.

The Electron follow-up is based on jdudetv's upstream `ELECTRON` branch at
`adbf262a510798c95892283d6d28a64ce7277e63`. It adds server-native device transports
instead of depending on `window.electronAPI`. See [Electron catalog](ELECTRON.md)
for coverage and remaining capability requirements.

Stateless plugins only export `Plugin.make({ id, effect })`; no engine definition,
deployment, RPC group, or client state is required. Standalone discovery uses the
package's `.` export when no `macrograph.standaloneDeployment` is specified, and
registers it directly if it has no engine. Plugins with engines still need an
explicit deployment for the host. Programmatic registration is `editor.plugin(plugin)`
and `executor.plugin(plugin)`, or `PluginMount.register(executor, plugin)` for both.

Engine implementation layers use `MyEngine.toLayer((mg) => Effect.gen(...))`.
The callback receives storage, resource refresh, credentials, client refresh, and
event emission through `mg`; implementations do not yield `MyEngine.EngineContext`.
Reusable engine builders accept `mg: Engine.ContextOf<typeof MyEngine>` directly.
`EngineContext` remains the host/test injection point.

## Added plugins

| Package            | Functionality                                                           | Runtime                            |
| ------------------ | ----------------------------------------------------------------------- | ---------------------------------- |
| `discord`          | Bot message events, sending messages, user/member/role lookup, webhooks | Server                             |
| `elevenlabs`       | Text-to-speech with an API key                                          | Server and Cloudflare              |
| `elgato-key-light` | Key Light state, power, brightness, and temperature controls            | Server with reachable Key Lights   |
| `fs`               | File/folder listing and UTF-8 text reads and opt-in writes              | Server                             |
| `goxlr`            | Mixer controls and status events                                        | Server with reachable GoXLR daemon |
| `ikea-tradfri`     | TRADFRI gateway light control                                           | Server with reachable gateway      |
| `json`             | JSON parsing, querying, typed extraction, and immutable object edits    | Server, browser, and Cloudflare    |
| `lifx`             | LIFX LAN state, power, color, and brightness controls                   | Server with reachable LIFX lights  |
| `list`             | Explicitly typed list creation, editing, lookup, and joining            | Server, browser, and Cloudflare    |
| `logic`            | Boolean operations, branching, waiting, and typed conditionals          | Server, browser, and Cloudflare    |
| `math`             | Numeric operations and conversions                                      | Server, browser, and Cloudflare    |
| `openai`           | Chat completion and image generation with an API key                    | Server and Cloudflare              |
| `shell`            | Opt-in shell command execution                                          | Server                             |
| `speakerbot`       | Speech and queue controls                                               | Server with reachable SpeakerBot   |
| `streamdeck`       | Key down/up events from a WebSocket forwarder                           | Server                             |
| `streamlabs`       | Donation and YouTube membership/superchat Socket API events             | Server                             |
| `string`           | String operations and conversions                                       | Server, browser, and Cloudflare    |
| `tiktok-euler-stream` | TikTok (Euler Stream) LIVE events                                     | Server                             |
| `voicemod`         | Voice selection, voice changer, and hear-self controls                  | Server with reachable Voicemod     |
| `vtube-studio`     | Model, expression, and hotkey requests                                  | Server with reachable VTube Studio |

See integration package READMEs for protocol requirements and node details. Local apps
must be reachable **from the runtime host**, not just the editor's browser. In a
container, `localhost` refers to the container. No new device-connected plugins
are mounted in Cloudflare runtimes.

## Cloudflare

The hosted editor and execution registry share the new plugin lists in
`apps/cloudflare/src/plugins/CloudPlugins.ts`. Existing editor Durable Objects
rebuild the in-memory catalog when updated Worker code initializes them; no
project storage migration or reset is required. Reconnect the editor after
deploying the Worker to fetch the updated catalog.

OpenAI and ElevenLabs keys are configured in hosted plugin settings. Workflow
execution uses the API keys in the project's deployed R2 snapshot, with read-only
engine contexts and no browser credential-session dependency. Redeploy the project
after changing its API keys or graph. Keys remain in project storage and deployment
snapshots, not settings client state, so protect those storage locations.
Clearing a key in editor settings does not erase earlier deployment snapshots;
rotate or revoke the provider key if immediate revocation is needed.

Cloudflare [limits non-stream Workflow step results to 1 MiB](https://developers.cloudflare.com/workflows/reference/limits/).
Graph node results currently use non-stream values, so large image/audio base64
outputs or chat histories can exceed that limit and fail execution. Large artifacts
require a separate storage-backed output strategy; this port does not add one.
Workflow step retries can repeat provider calls, including billable requests.

## Configuration and security

Integration credentials are configured through plugin settings and retained in
server-side engine storage. Client state reports whether credentials are
configured rather than returning the stored secrets. Project SQLite files and
backups still contain these secrets and must be protected. Grant edit access only
to trusted users; editors can configure plugins and run graphs.

Read-only project RPC responses omit engine storage. Read-only event streams and
raw WebSocket broadcasts send client-state invalidations instead of persisted
engine state. Authorized editors retain full project access, including secrets,
for existing project workflows.

Filesystem nodes operate with the server's filesystem permissions. Shell execution
is disabled unless the host explicitly sets `MACROGRAPH_ENABLE_SHELL=true`. It is
not sandboxed and must never receive untrusted command text. Neither feature
accesses files or processes on the editor user's computer.

Text-file writes additionally require `MACROGRAPH_ENABLE_FILE_WRITES=true`.
They create or overwrite files without a sandbox; reads and writes follow the
server's filesystem permissions. Network-device configuration also grants graph
authors access from the runtime host. Restrict project editing to trusted users.

Discord message content requires the corresponding privileged intent to be
enabled in the Discord developer portal. Streamlabs requires its Socket API token,
not an OAuth access token. VTube Studio requires local user approval of the plugin.
Voicemod uses a configured registration key rather than the legacy embedded key.

## Adaptations

These are current-runtime ports, not an automatic migration of persisted legacy
graphs. Plugin/schema identifiers and pin shapes follow the current API.

String input autocomplete uses the `suggestions` Effect resolver, the counterpart
of legacy `fetchSuggestions`. Resolvers receive current properties (with resource
constants resolved), persisted input defaults, and the hosted engine's runtime RPC
client. OBS, VTube Studio, and Voicemod query the live integration; ElevenLabs model
IDs use the legacy static list. Suggestions refresh when an input is focused, and
failed lookups leave it editable as free text.

The current type system has scalar, list, and option pins, but no generic map,
struct, or enum pins. Integration structures and JSON values therefore use JSON
strings; list operations use an explicit element type instead of wildcard
inference. Invalid inputs and provider failures fail execution rather than silently
producing success.

OpenAI chat completion is non-streaming because legacy streaming scope pins have
no current equivalent. ElevenLabs returns encoded audio instead of writing a file
through the old Tauri bridge. File attachments and arbitrary native file writes
through the old bridge are not ported. Explicit UTF-8 reads/writes are available
through the Filesystem plugin on an opted-in server.

## Deferred catalog

- Audio playback, browser keyboard input, global input emulation, and MIDI need
  explicit browser/desktop capability bridges.
- Localstorage needs a defined client-side storage scope rather than substituting
  server project storage.
- Variables and custom events need project/graph domain models and event registries.
- Generic Map, wildcard collections, struct/enum builders, and scope-based loops
  need type-system and execution-model extensions.
- GitHub, Google, Patreon, and Spotify were OAuth settings shells with no graph
  nodes in the reference; no placeholder integrations are added.
- HTTP, OBS, and Twitch are expanded but do not claim full Electron parity.
  HTTP adds text/header IO and URL helpers, Twitch adds 30 actions and richer chat
  inputs, and OBS adds canvas-aware requests and event/conversion helpers. See
  their READMEs for runtime/version requirements and remaining gaps.
- Math, String, Logic, and List cover runtime-compatible portions of the old
  utility catalog without changing existing schema IDs. Utilities adds
  deterministic UTC/duration formatting and log severity selection; List adds
  execution-time random selection; Logic Cache and Copy support explicitly typed
  scalar lists.
