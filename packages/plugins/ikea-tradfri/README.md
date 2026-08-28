# IKEA TRADFRI Gateway

Server-native TRADFRI gateway support over CoAP/DTLS PSK on UDP 5684. This is
**not DIRIGERA support** and does not require Electron, a worker process, a
native binary, or browser access to the gateway. The gateway must be reachable
from the runtime host. Only trusted project editors should configure network
targets; private LAN addresses are deliberately allowed.

## Setup

Pair in settings using a plain IPv4 address or DNS hostname and the security
code printed on the gateway. The temporary `Client_identity` DTLS session POSTs
`15011/9063` with a fresh identity (`9090`), validates the returned PSK (`9091`),
closes the temporary session, and verifies a new authenticated connection before
saving credentials. The printed security code is not persisted. Identity/PSK
remain in server project storage, not settings client state or error messages.
Protect project files, backups and authorized editor access: storage is not an
encrypted secret vault. Forgetting credentials does not erase older backups or
revoke gateway-side identities.

Refresh Lights enumerates `15001`, fetches each device, filters type 2 bulbs,
and atomically replaces persisted light resource metadata (IDs and names only).
Type 3 accessories are unsupported plugs using `3312`, not lights, and are skipped.
Select those resources in graph node properties. A failed refresh fails visibly
without publishing a silently partial list. List Lights always queries fresh
states, and Get Light State never falls back to cached state on failure.

Mounting is inert, even with saved credentials. Requests connect on demand using
the saved identity/PSK; Reconnect explicitly replaces the project-owned session.
Disconnect closes it, but a future request reconnects on demand. Save Address
allows moving the same gateway to a new IP without pairing again; credentials
are retained, and resource metadata is cleared if the host changes. To switch
gateways, pair the new gateway instead. Project shutdown closes its session and
rejects all pending exchanges. No global socket, request resolver or worker is
shared between projects.

## Nodes

Exactly **six** registered schemas from the seven-node ELECTRON source:

| Schema                | Behavior                                                                        |
| --------------------- | ------------------------------------------------------------------------------- |
| `SetLightState`       | Power only (`5850`).                                                            |
| `SetBrightness`       | Integer brightness 0-254 (`5851`), not percent.                                 |
| `SetColorTemperature` | Integer 2200-4000 Kelvin, rounded to mireds (`5711`).                           |
| `SetColor`            | Six RGB hex digits, optional `#`, normalized to lowercase (`5706`).             |
| `ListLights`          | Fresh JSON array of light states; the current pin system has no struct list.    |
| `GetLightState`       | Fresh power, brightness, reachability/name, and optional Kelvin/hex color pins. |

Commands modify only requested fields on the first light channel. A successful
CoAP 2.04 means gateway acceptance, not proof of physical completion. Color and
temperature require compatible lamps; no unsupported capability is fabricated.
Gateway response state fields absent on a lamp are represented as options, not
invented zero/empty values. The source gateway's zero-mired sentinel also means
temperature unavailable. Inputs outside bounds fail rather than being silently
clamped.

## Protocol And Limits

`effect-node-dtls` supplies scoped DTLS 1.2 PSK sockets over `effect-node-udp`;
`coap-packet@^1.1.1` supplies the pure CoAP codec. The DTLS cipher is
`TLS_PSK_WITH_AES_128_CCM_8`, with the reference gateway anti-replay-window
compatibility option. No private third-party socket cleanup API is used.
DNS hosts are resolved to IPv4 before opening DTLS; resolution and handshake
share the configured connection deadline. Interruption and parent-scope shutdown
cancel the resolution wait immediately; neither can start a connection when its
underlying DNS lookup later completes.

Each CoAP request is confirmable, has an eight-byte session/MID token, and is
correlated by the complete token. Piggyback ACK responses also require the
original MID. Empty ACKs stop retransmission but do not resolve a response;
separate CON/NON responses use the token, and CON responses/duplicates receive
empty ACKs. MIDs are never reused within a session; exhausting 65,536 IDs closes
the session and requires a subsequent reconnect. Requests retransmit the same
packet with randomized 2-3 second initial delay and exponential backoff, at most
four retries, bounded by the configured 1-30 second deadline. Mutating graph
retries can still repeat operations; no exactly-once guarantee is claimed.

Device resource IDs are unsigned 32-bit integers (0-4294967295), independent of
16-bit CoAP message IDs. Normal bulb resource paths include `15001/65537` and
`15001/65538`; resource IDs are sent as decimal Uri-Path segments without truncation.

Bounds: 32 concurrent native exchanges, 128 completed duplicate-CON records,
256 enumerated devices, 32 KiB response JSON, 4 KiB outgoing JSON, and 60 seconds
for complete enumeration. Native
handshakes and exchanges have Effect deadlines and interruption; scope/connection
shutdown fails pending Deferreds and stops receiver/retransmission fibers.
Unexpected statuses, resets, malformed packets, invalid UTF-8/JSON, ID mismatch,
bad light state fields, and transport errors fail explicitly with sanitized
errors. Missing Content-Format is accepted for gateway compatibility; if present
it must be application/json (50).

## Deferred

`LightStateChanged` is **not registered**. CoAP Observe registration,
notification sequencing, cancellation, resubscription and gateway reconnect
reconciliation are deferred. There is no fake event, synthesized success, or
fallback background polling. CoAP Observe and blockwise transfer responses fail
explicitly instead of silently processing an incomplete body. IPv6 hosts,
discovery, non-light devices, multi-channel selection, transition times and
DIRIGERA are not implemented. Hardware interoperability has not been exercised
in this workspace; tests use mocked transports and real CoAP codec fixtures.

## Exports And Verification

Package exports: default plugin at `.`, `./Definition`, `./Engine` (default native
layer, `runtimeLayer`, injectable `Transport` and `transportLayer` requiring
`DtlsClient` and `HostResolver`), `./Deployment` (default
deployment), and `./Settings` (`settings`). `macrograph.standaloneDeployment`
points to `./src/Deployment.ts`. Parent host code owns registry/settings wiring;
this package is server-only and must not be mounted in Cloudflare runtimes.

Run `pnpm typecheck` and `pnpm run test --run` in this package. Tests cover schema/RPC
routing, credential secrecy, pairing/refresh validation, persisted reconnect,
inert mounts, project isolation, scope cleanup, cancellation, complete refresh
timeouts, command conversion, concurrent token/MID correlation, separate ACKs,
duplicate CONs, retransmission, response errors/bounds and typed DTLS options.
