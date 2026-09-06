# WebSocket Client

The hosted deployment accepts only credential-free `wss://` URLs on port 443 and rejects
obviously local or special-use hosts. Local execution also permits `ws://` and private hosts.
Hostname validation cannot prevent DNS rebinding, so hosted deployments must enforce outbound
network policy as well.

Only text frames are exposed to graphs. Binary frames and text frames over 1 MiB are dropped;
outbound text over 1 MiB fails with a typed error. Connection errors never include URL credentials.
Connections do not automatically reconnect because the reference implementation did not provide
a functioning reconnect loop. Connect-on-startup is attempted once.

Cloudflare workflow execution uses the unavailable deployment: definitions remain editable and
discoverable, but connect and send operations fail explicitly because outbound WebSocket lifetime
cannot be guaranteed across suspension.
