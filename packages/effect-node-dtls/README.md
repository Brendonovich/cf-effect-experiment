# Effect Node DTLS

A source port of the PSK client path in `node-dtls-client` onto
`effect-node-udp`. There is no dependency on, wrapper around, or private API call
into the upstream package. Node crypto implements the cryptographic primitives;
Effect owns UDP allocation, sends, receives, timeout, cancellation and scope cleanup.

## Limited Scope

This package supports **only full DTLS 1.2 PSK handshakes with
TLS_PSK_WITH_AES_128_CCM_8 (0xc0a8)** and null compression, for the IKEA gateway
integration. It is not a general TLS implementation and has not received an
independent security audit. Do not treat it as an audited, general-purpose secure
transport. An 8-byte CCM tag is deliberately retained for firmware interoperability.
Use strong, provisioned PSKs and trusted local networks. PSK-only key exchange
does not provide forward secrecy. Extended master secret, certificates, session
resumption, renegotiation, other cipher suites and arbitrary TLS extensions are
not implemented. Unsupported negotiation is rejected, not silently downgraded.

**Handshake flights are not retransmitted.** This intentionally retains the
upstream limitation. A lost flight, or epoch-one record arriving before
ChangeCipherSpec, can cause the bounded handshake to time out. Reordered fragments
within the current bounded handshake flight are reassembled; arbitrary flight
reordering is not supported. Reconnect with a fresh session to retry a handshake.
There is no application retransmission, acknowledgement, ordering or reliability;
application/CoAP layers must provide their own policy. `send` means UDP submission,
not remote receipt. Local `close` immediately marks the session closed and wakes
pending operations, then awaits idempotent local transport/scope cleanup. It does
not await a close_notify exchange. Authenticated remote close_notify tears down
the session.

## API

`DtlsClient.connect(options)` requires `Scope.Scope` and returns a socket **only
after authenticating the server Finished**. `layer` requires `UdpSocket` and can
use an injected transport; `nodeLayer` provides the production Node UDP layer.
Building either DTLS layer is inert: allocation happens only inside `connect`.

```ts
import { Effect } from "effect";
import { DtlsClient, nodeLayer } from "effect-node-dtls";

const program = Effect.scoped(
  Effect.gen(function* () {
    const dtls = yield* DtlsClient;
    const socket = yield* dtls.connect({
      address: "192.0.2.1", // IP literal; DNS resolution belongs to the caller
      port: 5684,
      identity: "provisioned-identity",
      psk: "provisioned-ASCII-key",
      timeoutMs: 5000,
    });
    yield* socket.send(new Uint8Array([1, 2, 3]));
    return yield* socket.receive;
  }),
).pipe(Effect.provide(nodeLayer));
```

Options have readonly `address`, `port`, `identity`, `psk: string | Uint8Array`,
optional `timeoutMs`, and optional `resetAntiReplayWindowBeforeServerHello`.
Identity and string PSKs are 1..256 **ASCII bytes**. Strings are literal keys,
not hexadecimal; binary keys use `Uint8Array` (copied, never mutated). The default
timeout is 5000ms; accepted values are 1..120000ms, covering allocation and the
entire handshake. Timeout and interruption release the child session scope
immediately, even if the caller's scope remains open.

A socket exposes `send(data): Effect<void, DtlsError>`,
`receive: Effect<Uint8Array, DtlsError>`, `close: Effect<void>` and
`isOpen(): boolean`. `DtlsError` contains a typed `reason` and `cause`.
The first terminal transport/protocol/overflow/close error is persistent: it
wakes every pending send and receive and fails subsequent operations with the
same error. Scope exit closes the transport and interrupts the receive worker.
Explicit `close` also releases the child session scope and joins its receive worker.
Concurrent `close` calls all await the same actual transport and scope cleanup completion.
The entire public close operation is uninterruptible through scope finalization
and worker join; interruption is observed only after local cleanup completes,
so it cannot strand a completion latch or skip finalizers on an already-closed scope.
Failure cleanup covers acquisition through final ownership transfer under an
interruption mask and waits child finalization even when another closer has
already marked that scope closed. Sending oversized application data is a terminal
protocol error.

## Protocol Review

- Session transitions and outgoing sequence allocation are serialized with one
  Effect semaphore. Close is independent of that semaphore, so it can wake a send
  blocked in transport and other operations waiting for the permit.
- Datagram sources must match the configured IP and port before any protocol or
  replay state changes. IPv6 address bits are canonicalized without throwing on
  foreign or invalid peers. Scoped literals such as `fe80::1%lo0` are supported;
  zone suffixes must match exactly (including case), are never stripped for peer
  comparison, and are forwarded unchanged to UDP. Interface-name/numeric zone
  aliases are not resolved. This is source filtering,
  not protection from an attacker who can spoof the configured peer.
- Record parsing validates complete datagrams before processing; it bounds UDP
  payloads to 65507 bytes, record count to 64, and plaintext to 16384 bytes plus
  the exact 16-byte CCM8 overhead. Truncated/malformed record datagrams, unknown
  epochs, bad MACs and replayed records are discarded.
- The only epochs are zero and one. ChangeCipherSpec must be exactly `01`, arrive
  in epoch zero after the server flight/key schedule, and transition only once.
  Finished must be epoch-one authenticated ciphertext and have the correct
  12-byte transcript PRF, checked with `timingSafeEqual`.
- Epoch-zero application data is never accepted. Application data arriving before
  authenticated Finished is discarded, even if encrypted, not buffered for later
  delivery. Post-Finished data is copied into a 64-datagram bounded queue (at most
  1MiB). Overflow discards the queue and terminates the session.
- Fragment parsing checks lengths/offsets before allocation. Reassembly has at
  most eight pending messages, 4096 bytes per message, 16384 total body bytes plus
  same-size coverage maps, 256 fragments per handshake, and a bounded sequence
  window. Conflicting overlap/metadata is rejected. Transcripts are capped at
  16384 bytes. Multiple handshake messages in one record are processed.
- The 64-record replay bitmap is updated **after** authenticated decryption and
  separately for each record, so duplicates within one UDP datagram cannot slip
  through. BigInt bitmap shifts are bounded, handle 32/64-boundary cases, and
  allow large authenticated sequence jumps without permanently stalling a session.
- Epoch and all 48 sequence bits form the explicit encryption nonce, replacing
  upstream's random explicit nonce. A sequence is reserved before encryption or
  UDP send and is never reused after a failure/interruption. Sequence exhaustion
  is rejected rather than wrapped. Keys are fresh per connection and retained
  key buffers are zeroed on teardown (not a guarantee of erasing every VM copy).
- The IKEA v1.15.x workaround is opt-in: reset **only epoch zero**, once, immediately
  after accepting the single HelloVerifyRequest and before ServerHello. It never
  resets the authenticated epoch-one replay window or allows repeated HVR resets.
- A cookie exchange excludes the initial ClientHello/HVR from the transcript.
  A server omitting HVR includes the initial ClientHello, fixing upstream's
  cookie-less transcript bug. Cipher, version, compression and extension choices
  are checked against the narrowly offered capabilities.

This review addresses the specific implementation bounds above; it is not a
cryptographic security proof. Peer-spoofed epoch-zero traffic can still abort a
handshake, and invalid authenticated-record floods can consume CPU. There is no
automatic key rotation; keep sessions bounded at the application level.

## Provenance

Upstream: <https://github.com/AlCalzone/node-dtls-client>, version **2.0.3**,
commit **a7f2859e2b13e45ffe1bad491c53757fa1003d98**. The upstream MIT notice from
its README is retained in `LICENSE` and source headers.

This is a narrowed and modernized source port, not a verbatim vendor tree:

| Local Source                   | Upstream Source / Retained Logic                                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/TLS/PRF.ts`               | `TLS/PRF.ts`: SHA256 HMAC P expansion and labeled TLS 1.2 PRF                                                                                        |
| `src/TLS/ConnectionState.ts`   | `TLS/ConnectionState.ts`, `TLS/PreMasterSecret.ts`: PSK premaster, master secret and ordered key expansion                                           |
| `src/TLS/AEADCipher.ts`        | `TLS/AEADCipher.ts`, `lib/AEADCrypto.ts`: nonce/AAD layout, native CCM encrypt/decrypt and tag verification                                          |
| `src/TLS/AntiReplayWindow.ts`  | `TLS/AntiReplayWindow.ts`: bounded 64-record sliding replay bitmap, corrected shifts/jumps                                                           |
| `src/DTLS/RecordLayer.ts`      | `DTLS/RecordLayer.ts`, `DTLS/DTLS{Plaintext,Compressed,Ciphertext}.ts`: record layouts, epochs, send sequence and authenticated receive pipeline     |
| `src/DTLS/Handshake.ts`        | `DTLS/Handshake.ts`: handshake/fragment wire layout, sequence-based assembly with checked bounds                                                     |
| `src/DTLS/HandshakeHandler.ts` | `DTLS/HandshakeHandler.ts`: ClientHello/HVR/server flight/PSK CKE/CCS/Finished, transcript and firmware reset                                        |
| `src/lib/codec.ts`             | `lib/BitConverter.ts`, `TLS/TLSStruct.ts`, `TLS/Vector.ts`: checked fixed-width integers and length-prefixed fields, replacing dynamic legacy codecs |
| `src/index.ts`                 | Replacement for `src/dtls.ts` events, dgram transport and timers: scoped Effect service and serialized session lifecycle                             |

Removed paths include legacy Node/Electron AEAD fallback, CBC/GCM/other suites,
general dynamic object codecs, event emitter transport and native timers. No
`as any`, TypeScript suppression, direct dgram send, or upstream private teardown
method is used in this package.

## Tests

Run `pnpm --filter effect-node-dtls test` and `pnpm typecheck`.
Tests cover PRF vectors, 48-bit codecs, CCM8 authentication, replay boundaries,
fragment bounds/overlap, negotiation, cookie/no-cookie handshake transcripts,
timeouts, interruption (including 500 scheduler-yield positions through allocation
and handshake return), concurrent asynchronous close, interrupted scope cleanup
(a gated finalizer and 60 scheduler-yield positions after transport close), scope
disposal, blocked operations, queue overflow, foreign zoned/invalid IPv6 peers,
exact zone identity, bad MACs, pre-Finished data and the opt-in firmware reset.

The production interoperability test launches `openssl s_server -dtls1_2 -nocert
-cipher PSK-AES128-CCM8:@SECLEVEL=0` on ephemeral IPv4 and IPv6 loopback ports and verifies
application data in both directions through the real `nodeLayer`. Set `OPENSSL`
to an alternate executable. It is explicitly skipped when an OpenSSL executable
with PSK-AES128-CCM8 is unavailable. Child processes are scoped and killed on
cleanup. When the host exposes an internal link-local IPv6 interface, the test
also exercises its zoned loopback literal (for example `fe80::1%lo0`) through
production UDP and DTLS. The test server explicitly lowers OpenSSL policy because its default
security level rejects CCM8's 64-bit tag; this is not a production security
recommendation. This is real protocol interoperability, not a hardware/firmware test;
no physical IKEA gateway has been used for this package's tests.
