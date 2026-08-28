# TikTok (Euler Stream)

Server-only, read-only TikTok LIVE event integration with two explicit transports:
the default pinned `tiktok-live-connector@2.4.4` and optional managed Euler WebSocket
mode matching the Electron branch's service. This is **unofficial and unaffiliated with TikTok**.
TikTok can change its internal Webcast protocol without notice; blocked server
IPs, offline creators, region restrictions, signing outages, and provider rate
limits can prevent connections. No live-provider reliability claim is made by
the mocked test suite. Review the connector's modified AGPL license before
redistributing or deploying it.

## Configuration

Save a creator username (`creator` or `@creator`, not a URL), then click Connect.
New and disabled configurations are inert: saving does not create a connection.
Saving while enabled replaces the current connection. Enabled configurations
connect when their project engine starts. Disconnect persists `enabled: false`;
Clear Configuration removes the username and key, disconnects, and resets the mode
to `connector`. `mode` is required in storage and `TikTokConfigure`; new engines
start with `initialStorage.mode: "connector"`. No legacy storage migration is included.

In `connector` mode, the connector uses the third-party **Euler Stream signing service** even without
an API key. Public streams can use its community limits; an optional Euler API
key may raise limits depending on the provider's current policy and account plan.
This is not the Electron branch's managed `wss://ws.eulerstream.com` service.
The runtime host needs outbound HTTPS/WSS access to TikTok and `https://api.eulerstream.com`.

In `managed` mode, the server connects directly to `wss://ws.eulerstream.com` using
the Electron service's `uniqueId` and `apiKey` query parameters. An Euler API key
with managed WebSocket access is required, including any provider account plan,
permissions, or quota requirements. Branch users can select this mode and enter
their existing Euler key. Signing-service access alone is **not equivalent** to
managed WebSocket access. No purchase, subscription, entitlement, or uptime
guarantee is supplied by the plugin. Keys are only sent to this fixed WSS endpoint;
redirects are disabled. Never log socket URLs, which contain the key.

The key (optional for connector, required for managed) is stored server-side in project engine storage. Client state
only reports `apiKeyConfigured`, never the key. Errors expose fixed reason codes,
not provider exceptions, URLs, or storage parameters. Protect project databases,
deployment snapshots, backups, and editor access: storage is not encrypted by this
plugin. Removing a key does not erase older backups or snapshots; revoke it with
Euler if necessary. Omitting `apiKey` in `TikTokConfigure` preserves it; explicitly
passing `""` removes it. Switching modes preserves an omitted key; verify that it
has access to the newly selected service. Every connector connection has its own Euler SDK client, avoiding
the connector's global `SignConfig` credential cache and cross-project key leaks.

## Event Nodes

All 19 schemas have User, User ID, Nickname, and Payload JSON outputs, plus their
event-specific scalar pins. User identity is blank when the provider does not
include it. IDs remain strings to avoid precision loss. Payload JSON preserves
additional provider fields, including battle participant/army and viewer ranking
structures; use the JSON plugin for these rather than expecting struct/map pins.

| Schema               | Additional Outputs                                           |
| -------------------- | ------------------------------------------------------------ |
| `TikTokChat`         | comment                                                      |
| `TikTokGift`         | giftId, giftName, diamonds, repeatCount, giftType, repeatEnd |
| `TikTokGiftStreak`   | giftId, giftName, diamonds, repeatCount, giftType, repeatEnd |
| `TikTokMember`       | memberCount                                                  |
| `TikTokFollow`       | None                                                         |
| `TikTokShare`        | None                                                         |
| `TikTokLike`         | likeCount, totalLikeCount                                    |
| `TikTokRoomUser`     | viewerCount                                                  |
| `TikTokQuestion`     | question, questionId                                         |
| `TikTokEmote`        | emoteIdsJson                                                 |
| `TikTokEnvelope`     | envelopeId, diamonds, peopleCount                            |
| `TikTokLiveIntro`    | description                                                  |
| `TikTokBattle`       | battleId, action                                             |
| `TikTokBattlePoints` | battleId, giftId, giftCount, totalDiamondCount, repeatCount  |
| `TikTokSuperFan`     | message                                                      |
| `TikTokSuperFanJoin` | message                                                      |
| `TikTokStreamEnd`    | action                                                       |
| `TikTokGoalUpdate`   | description, contributor, contributeCount, contributeScore   |
| `TikTokRoomMessage`  | message                                                      |

Connector mode supports all 19 nodes. Managed mode explicitly supports the six
Electron branch events (chat, gift, member, follow, share, like), plus the derived
gift-streak node. The other 12 catalog nodes require connector mode; no unsupported
managed event or stream-end payload is synthesized. Managed framing accepts single
`{ type, data }` messages and `{ messages: [...] }` batches. It tracks `roomInfo`,
`room.status`, `tiktok.connect`, and `tiktok.disconnect`; opening the underlying
WebSocket is not treated as successfully joining a live room.
`TikTokGift` fires only for completed streaks or non-streakable gifts, matching the
branch's accounting behavior. `TikTokGiftStreak` receives unfinished type-1 streak
updates instead. `diamonds` is the cost of **one gift**, not the streak total;
multiply by `repeatCount` only on the completed Gift node. Do not sum intermediate
streak updates. Gift names/costs use supplied metadata; missing names fall back to
`Gift` and missing costs to zero. Extra gift-list fetching is deliberately disabled
so an optional catalog service cannot block the connection.

The decoder validates consumed fields with Effect Schema and requires the relevant
event fields before emission. It handles both the Electron/Euler aliases and the
pinned connector's native v3 fields (`user.displayId`, chat `content`, like `count`
and `total`, viewer `total`, question `data.content`, gift `gift.type/name/diamondCount`).
Boolean and numeric 0/1 gift streak flags are supported. Counts must be nonnegative
safe integers; malformed and unsafe values are rejected rather than coerced to
success. Connector social actions are classified conservatively. Managed social
messages preserve the Electron dispatch rule: a non-null `shareType` (including
zero), `displayStyle: 2`, or `action: 3` routes to Share; otherwise it routes to
Follow. The provider payload still must pass the event schema. Identity fallbacks
skip empty and zero protobuf IDs instead of masking populated nested IDs. Opaque
extra JSON fields are preserved but are not given full protocol-specific schemas.
Payload JSON is capped at 1,048,576 characters; cyclic/unserializable payloads are
rejected and bigint values serialize as decimal strings.

## Lifecycle And Limits

Each engine owns one connection, a scoped callback consumer, and a bounded
1,024-entry queue. Reconfigure, disconnect, clear, and project shutdown detach all
listeners and close that connection only. Generation checks reject stale callbacks
and queued events. Signing requests are aborted on teardown; an abandoned connect
that completes later is closed again. Connector HTTP requests retain its built-in
timeout/retry behavior (the pinned version's optional HTTP settings declaration
incorrectly requires an internal cookie jar). Signing and handshake timeouts are
15 seconds; engine disconnect waits are bounded to 5 seconds. Managed mode uses
a 15-second WebSocket handshake timeout, a 30-second initial room-readiness timeout,
and a 1 MiB frame limit. Disconnect aborts even an in-flight handshake, cancels the
readiness timer, and removes protocol listeners. A temporary no-op error guard is
retained only until `ws` closes during teardown, then all socket listeners are removed.

Connection failure, invalid payloads, disconnect failure, and queue overflow are
visible in settings through sanitized state codes. Overflow drops events rather
than allowing unbounded memory use. Retry manually with Connect; there is no
client-side automatic reconnect or offline polling. Managed provider
`reconnecting` statuses are reflected but do not create replacement sockets.
Actual managed close codes distinguish offline creators (`4404`), authorization
failures (`4401`/`4403`), provider failures (`4556`/`1011`), and normal stops
(`1000`/`4005`), without exposing provider error messages. Malformed managed frames
and room-control payloads close the socket with a sanitized error.
Initial chat/history replay is disabled in connector mode to avoid rerunning graph
actions on reconnect. Managed mode uses the branch's protocol without inventing
an undocumented replay-suppression option, so provider replay behavior is not
guaranteed. TikTok does not guarantee every
like/member/social event, and event shapes and availability vary by live room.

No authenticated TikTok sessions, cookies, OAuth, mobile transport, chat sending,
moderation actions, media capture, paid analytics,
or gift catalog service are implemented. Low-level protocol, shop, ranking, poll,
and moderation events outside the catalog are not exposed as placeholder nodes.
No browser, Electron bridge, or Cloudflare deployment is provided.

## Integration And Tests

Exports: `.` is the default plugin; `/Definition` contains `TikTokEngine`, schemas,
and client RPCs; `/Engine` exports injectable `layer` and a default real-client
layer; `/Deployment` exports the standalone deployment; `/Settings` exports the
Solid v2 settings component and named `settings`; `/Transport` exports the
`ClientFactory` service, `clientLayer`, and injectable `createManagedClient`;
`/Events` exports `decodeEvent`. Existing plugin and node/schema IDs are unchanged.

The host must add the workspace dependency and TypeScript reference, register the
plugin/deployment for server execution, and discover the settings export. The
manifest includes `macrograph.standaloneDeployment` for production discovery.
No shared host files are changed by this package.

Run `pnpm --filter @macrograph/plugin-tiktok-euler-stream test run` and
`pnpm --filter @macrograph/plugin-tiktok-euler-stream typecheck`. Tests inject fake clients to
cover persistence, enable/reconfigure/disable/shutdown, late connection cleanup,
project isolation, secret redaction, and payload rejection. The catalog test runs
every schema and checks its output pins. The real adapter test mocks network
connect/disconnect methods while checking actual SDK credential isolation and
connector event wiring. Managed tests inject fake WebSockets to cover the branch's
protocol, close codes, states, frame validation, timers, and cleanup. Protobuf
regressions use the installed v3 decoder defaults, not handcrafted empty values.
No live TikTok or Euler requests are made.
