# Effect Node UDP

`effect-node-udp` provides a scoped Node `node:dgram` transport for Effect v4.
Provide `nodeLayer`, yield `UdpSocket`, and call `open` inside a scope. Layer
construction is inert. `open` defaults to IPv4, the wildcard address, an ephemeral
port, and a receive capacity of 256 datagrams; IPv6 is also supported.
Bind and peer addresses must be IP literals. Numeric lookup is synchronous, so
Node cannot submit a datagram after cancellation during an asynchronous DNS lookup.
Bind addresses must match the socket family. Bind ports are integers from 0 to
65535; destination ports are integers from 1 to 65535. Invalid open options fail
before socket allocation. Invalid peer inputs are terminal `Send` failures and
never reach Node's send method, including empty addresses that Node would otherwise
replace with loopback.

Each socket exposes `localAddress`, `send(data, peer)`, `receive`, and idempotent
`close`. Receive listeners are installed at allocation, before binding or sending,
so immediate replies are queued even before a caller starts receiving. Datagram
data is copied, and concurrent receives consume the queue in order.

The queue is bounded. Overflow fails and closes the socket rather than silently
dropping packets or spawning unbounded fibers. Bind, send, and receive errors are
terminal and persistent: pending and future operations fail with the first
`UdpError`, including queued receives. Closing immediately unblocks pending bind,
receive and send operations with `Closed`. Cleanup is registered before the
interruptible bind. The complete open operation is guarded: failure or interruption
from allocation through returning the socket cleans up without waiting for the
caller's scope to close. Successful opens remain owned by that scope. Physical
Node close may finish later when a pending bind completes; logical close does not
wait for that event. No sends are scheduled from late listening events.

Interruption removes a pending send callback, but cannot recall a datagram already
submitted to the OS. `send` completion means local submission, not peer receipt.
UDP does not authenticate peers, guarantee delivery, or encrypt traffic. Callers
must implement protocol correlation and timeouts. The `SocketFactory`, `RawSocket`
and `layer` exports allow deterministic Node-boundary lifecycle tests.

API inspiration: Pedro Casaretto's Effect `udp-socket-2` proposal at
https://github.com/pcasaretto/effect/tree/udp-socket-2 . This implementation is
written independently for Effect v4, with a bounded pull queue and different
scoping, terminal-error and cancellation behavior; it does not copy proposal code.

Run `pnpm --filter effect-node-udp exec vitest run` after workspace installation.

## Usage

```ts
import { Effect } from "effect";
import { nodeLayer, UdpSocket } from "effect-node-udp";

const exchange = Effect.scoped(
  Effect.gen(function* () {
    const udp = yield* UdpSocket;
    const socket = yield* udp.open({ address: "127.0.0.1" });
    const peer = { address: "127.0.0.1", port: 8080 };
    yield* socket.send(new TextEncoder().encode("hello"), peer);
    while (true) {
      const datagram = yield* socket.receive;
      if (datagram.peer.address === peer.address && datagram.peer.port === peer.port)
        return datagram.data;
    }
  }).pipe(Effect.timeout("2 seconds")),
).pipe(Effect.provide(nodeLayer));
```

This example expects a UDP server at the destination. Its peer check filters
unrelated traffic, but a real request/response protocol also needs packet-level
correlation and validation, such as LIFX's source and sequence fields.
