# Streamlabs

Standalone-server plugin using `socket.io-client` for the Streamlabs Socket API.
Configure a Socket API token, not an OAuth access token. No OAuth profile shell
is required. The token lives only in private engine storage, not ClientState.
Protect engine storage and settings RPC access; storage is not an encrypted
vault. Plugin definitions and settings do not import the Socket.IO transport.

Five event nodes preserve the legacy payload semantics:

- Streamlabs Donation (`donation`, any source)
- YouTube Membership (`subscription`, `youtube_account` only)
- YouTube Superchat (`superchat`, `youtube_account` only)
- YouTube Membership Gifter (`membershipGift` with `giftMembershipsCount`)
- YouTube Membership Giftee (other `membershipGift` payloads)

Events must contain a nonempty message array. Like the legacy tuple decoder,
only the first message is used; subsequent batch entries are ignored. Wrong types,
unsupported sources/events, and non-finite numeric values are dropped. Missing
or null optional fields become empty strings or zero. Donation amounts and
membership months are numbers (months accepts finite numbers or legacy numeric
strings); superchat amount remains a string. Gift counts
are non-negative safe integers. Each node also exposes decoded Payload JSON.

The socket connects only to `https://sockets.streamlabs.com`, with the token
passed as an SDK query option. Socket.IO manages heartbeats and up to ten
automatic reconnection attempts. Replacement, disconnect, token removal, and
scope shutdown detach listeners and close the owned socket/manager. Late
callbacks are ignored. Errors exposed to clients are fixed sanitized messages.

Settings write failures, including persistence defects, become the typed
`storage-failed` reason without query parameters or tokens. Persistence logging
or tracing below this plugin boundary may still record the original failure.

Native callbacks are forwarded by a scoped Effect consumer with a 1024-item
burst buffer; excess callbacks are dropped if the engine cannot keep up.

Tests inject the SocketFactory service and use decoded fixture payloads. No
real credentials or network access are required.
