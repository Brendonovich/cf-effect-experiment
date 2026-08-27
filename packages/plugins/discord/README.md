# Discord

Standalone-server plugin with six nodes: Discord Message, Send Discord Message,
Get Discord User, Get Discord Guild Member, Get Discord Role By ID, and Send
Discord Webhook. One bot token is configured per engine. All REST bot routes use
`Bot` authorization against `https://discord.com/api/v10`.

The token is persisted in engine storage, not ClientState. Protect the engine's
storage files and settings RPC access; storage is not an encrypted vault. The
editor entry point and Settings do not import the server transport.

The gateway uses v10 JSON, GUILD_MESSAGES and DIRECT_MESSAGES intents, optional
MESSAGE_CONTENT, jittered heartbeats with ACK checking, session resume, and at
most five exponential-backoff reconnects per connection lifecycle. Fatal auth
or intent close codes stop immediately. Connect in settings to retry after
exhaustion. All sockets and timers are cleaned up on replacement, disconnect,
and scope shutdown. Enable MESSAGE_CONTENT in both settings and the Discord
developer portal to receive ordinary guild message content; without it Discord
limits content to its documented exceptions, including mentions and DMs.

Reconnect delays start at five seconds to respect IDENTIFY session limits.
The service keeps the IDENTIFY deadline across token replacements, intent
changes, and manual reconnects; canceled pending attempts do not consume a slot.
Resume endpoints are restricted to WSS Discord gateway hosts, without userinfo,
custom ports, query strings or arbitrary paths; invalid endpoints fall back to
the standard gateway. New sessions always use the standard gateway.

Native callbacks are forwarded by a scoped Effect consumer with a 1024-item
burst buffer; excess callbacks are dropped if the engine cannot keep up.

Only normal (`type: 0`) message-create events are emitted. Missing optional
fields become empty strings; roles are JSON arrays. Structured response data is
available as Payload JSON. The bot needs the Discord permissions for the target
channels and guilds. Sending messages suppresses mentions unless Allow @everyone
is explicitly enabled. Webhooks always suppress mentions.

Webhook URLs must be HTTPS Discord webhook paths, without credentials, query,
fragment, custom port, or arbitrary host. Recognized legacy Discord domains are
canonicalized to the fixed API origin. Redirects are disabled. Webhooks never
receive the bot Authorization header. Local file attachments are deliberately
deferred; webhook messages must contain text. Failures contain only typed,
sanitized reason codes, never response bodies, tokens or URLs.

Settings write failures, including persistence defects, become the typed
`storage-failed` reason without query parameters or tokens. Persistence logging
or tracing below this plugin boundary may still record the original failure.

Tests inject `Http` and `Gateway` services; gateway protocol tests use mocked
sockets and timers. No credentials or external calls are required. Node 22+
provides the production fetch and WebSocket implementations.
