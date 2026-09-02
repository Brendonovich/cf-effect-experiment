# OpenCode

`@macrograph/plugin-opencode` connects MacroGraph's self-hosted server to OpenCode V2 using `@opencode-ai/client/effect`.

## Connections

The plugin discovers the healthy registered OpenCode background service on the **MacroGraph host**, including its authentication. It never starts, stops, or restarts OpenCode. Discovery runs at startup, every 30 seconds, and when Refresh is selected. The discovered connection has a stable `local` ID, so graphs continue to work after the service changes its port or password.

Additional connections can be added in plugin settings with an HTTP(S) address, name, and optional password. Password authentication uses OpenCode's `opencode` username. Manual connections are persisted with stable IDs and can be edited or removed. Leaving the password blank when editing preserves it; Clear stored password removes it. Offline connections remain configured and retry automatically.

Passwords are stored in host-side plugin storage, not returned in client state or errors. Protect storage and backups. Use HTTPS for remote servers; HTTP does not encrypt credentials or prompts. Redirects are disabled for authenticated API requests.

## Nodes

| Node             | Behavior                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Create Session   | Creates a session, optionally queues an initial prompt, and outputs its session ID. Optional directory and title.            |
| Prompt Session   | Admits a prompt to an existing session and outputs its inbox ID. Returns after admission, not after an assistant completion. |
| Wait For Session | Waits for the selected session's agent loop to become idle, with a 30-minute timeout.                                        |

Select a connection in each node's properties. Session ID inputs on Prompt Session suggest the server's most recent 100 sessions; any session ID can also be supplied directly or wired from Create Session.

Create Session's Prompt input defaults to empty. Empty or whitespace-only prompts only create the session; otherwise the prompt is queued using the model already selected during creation. The original prompt text is preserved. The node returns after prompt admission, not after an assistant completion. A blank directory uses the OpenCode server's location. Prompt Session remains available for follow-up prompts to existing sessions.

Create an OpenCode Model resource constant and choose its value from the catalog-backed select, then select that constant in the node's Model property. Model values are `provider/model` strings, displayed as `Name (Org / Provider)` using the catalog's provider name, without showing IDs. The catalog combines enabled models from active providers across connected servers, deduplicated by ID; choose a model available on the node's selected connection. It uses each server's default location rather than individual session or directory catalogs.

The Automatic resource value is an empty string: it uses the server default for a new session or preserves the current model for an existing session. Choosing an explicit model when prompting switches the session model before admitting the prompt, affecting subsequent provider turns. Model selection is now a resource property, not a wireable text input.

Settings catalogs and model resource options refresh on `catalog.updated` events and stream reconnection, with 30-second polling as a fallback. Provider credentials, permissions, and interactive questions remain managed in OpenCode. Cancelling a graph cancels its HTTP request or wait, but does not cancel a prompt already admitted by OpenCode or interrupt its session.

## Deployment

The self-hosted server includes the plugin and its settings. Other Node hosts can mount the `./Deployment` export with Effect `FileSystem` and `HttpClient` services. The editor-facing plugin and settings do not import native service discovery. Browser-only and Cloudflare hosts do not mount this native deployment.

The SDK is pinned to `0.0.0-beta-18684`; its Effect peer dependency requires workspace Effect `4.0.0-rc.112`. A pnpm patch fixes two extensionless ESM imports in that SDK release for native Node loading.
