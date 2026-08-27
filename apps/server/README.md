# MacroGraph self-hosted server

The server runs the collaborative browser editor, editor RPC, plugin settings RPC, and local
runtime in one Node.js process. The current persistence model is one project in one SQLite file.

The browser workspace has Editor, Events, and Settings views. Edits and plugin configuration apply
to the running project automatically; there is no deployment step. Events streams recent plugin
events, execution node status, timings, and errors to signed-in owners/admins. Activity retains up
to 100 events and the latest 200 nodes per event, with bounded payload/error previews. It is held
only in memory, so restarting the server clears it. Event payloads may contain sensitive
data and are not available to anonymous read-only viewers.

## Local development

```sh
pnpm --filter @macrograph/server dev
```

This runs the backend and browser client in one Vite process. Vite loads the backend in a
server environment and hot-reloads it when server or workspace dependencies change, disposing
the old runtime before starting the next one. No backend build or watcher is needed; migrations
are read directly from `packages/persistence-sqlite/drizzle`. Development loads `apps/server/.env`
(and Vite's mode-specific env files), with existing environment variables taking precedence.

Production:

```sh
pnpm --filter @macrograph/server build
PORT=3001 MACROGRAPH_DATA_DIR=./data pnpm --filter @macrograph/server start
```

Open `http://localhost:5174` for the Vite development client. The backend remains at
`http://localhost:3001`. `GET /health/live` reports process liveness and
`GET /health/ready` reports readiness after persistence and plugin initialization. `GET /health`
is a compatibility alias for readiness.

## Configuration

### First-time setup

On an unconfigured server, startup prints `MACROGRAPH_SETUP_KEY <key>`. Open the server in
your browser, enter that key on the setup page, and approve the MacroGraph sign-in and server
registration. For Docker, find the key with `docker logs macrograph`.

The approving account becomes the server administrator and supplies its cloud-managed credentials.
The browser is signed in automatically and remembers its session. Other visitors cannot claim the
server without the key, and signing in as another account does not grant edit access unless its
user ID is included in `MACROGRAPH_ADMIN_IDS`.

The key is invalidated after setup and changes if an unconfigured server restarts. Treat logs as
sensitive, and use HTTPS when accessing the server remotely. Ownership is persisted separately in
`MACROGRAPH_DATA_DIR/macrograph-owner.json`, with the same file protections as authorization data.
Cloud authorization expiry or disconnection does not reopen setup or remove the administrator.
Existing registered installations retain their owner automatically when upgrading. Keep the owner
file along with the authorization files when backing up or moving the server.

### Environment

- `PORT` and `HOST`: listener, default `3001` and `0.0.0.0`.
- `MACROGRAPH_DATA_DIR`: persistent SQLite directory, default current directory; mount `/data` in the image.
- `MACROGRAPH_CLOUD_BASE_URL`: MacroGraph credential service base, default exactly
  `https://www.macrograph.app/api`. The legacy no-`www` origin is normalized automatically.
- `MACROGRAPH_ADMIN_IDS`: optional comma-separated MacroGraph user IDs that may edit this server's
  project in addition to the account that registered the server.
- `MACROGRAPH_BASE_PATH`: public path such as `/macrograph`. Set it at both image build and runtime.
- `MACROGRAPH_PUBLIC_ORIGIN`: externally visible HTTP(S) origin, without a path, used by the
  browser security policy. Set this when running behind a reverse proxy.
- `OTEL_EXPORTER_OTLP_ENDPOINT`: optional server OTLP/HTTP collector base URL, such as
  `http://localhost:4318`. The server appends `/v1/traces`; existing URLs ending in `/v1/traces`
  continue to work.
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`: full trace URL, used as-is instead of the general endpoint.
- `OTEL_EXPORTER_OTLP_HEADERS`: optional comma-separated `name=value` collector headers. Values
  may be percent-encoded, e.g. `Authorization=Bearer%20token`.
- `OTEL_EXPORTER_OTLP_TRACES_HEADERS`: trace-specific headers, replacing the general headers.
- `OTEL_SERVICE_NAME`: server trace service name, default `macrograph-server`.
- `VITE_OTEL_EXPORTER_OTLP_ENDPOINT`: optional browser OTLP/HTTP trace endpoint, set at build time.
- `MACROGRAPH_BROWSER_OTLP_ENDPOINT`: browser collector URL used by the runtime CSP; the image sets
  this from the browser build argument.

Browser tracing is disabled unless its endpoint is configured. Cross-origin collectors must allow
the application origin, `POST`, and the `Content-Type` request header. The server CSP adds only the
configured collector and public WebSocket origins to `connect-src`; reverse proxies that replace
CSP must preserve those sources. Do not put collector credentials in the browser endpoint URL.

### Server Tracing

Server tracing is disabled unless a collector endpoint is configured. It exports existing Effect
spans, including HTTP/RPC and graph execution spans, using OTLP/HTTP JSON (`application/json`).
The collector must accept HTTP OTLP, not gRPC (typically port `4318`, not `4317`). Traces are
batched every second and pending spans are flushed during graceful shutdown.

Every engine event dispatched to the executor produces an `Executor.handleEvent` span, even when
no graph matches. Twitch chat messages are identified by `macrograph.plugin.id=twitch` and
`macrograph.event.type=channel.chat.message` attributes. Independent events start separate traces;
events with an existing parent retain it, even if the parent has ended. Twitch's WebSocket listener
detaches connection-setup context before processing notifications. The span includes project, plugin, and event-type
attributes, not the event payload, and contains any spans created during graph execution.

The shared executor adds `Executor.matchEvent`, `Executor.executeEventNode`, `Executor.runNode`,
and `Executor.resolveInput` spans. Graph, node, schema, and input details remain in attributes. Node
spans cover resource/property resolution, input evaluation (including pure nodes), execution-driver
work, and output validation. Each actual schema invocation gets a `Schema.run <plugin>.<schema-id>`
span, such as `Schema.run util.Print`, with plugin/schema/node identity also in attributes. It wraps
the callback and its returned Effect; plugin-created sub-operation spans nest beneath it. Cache
hits that skip the callback do not produce a schema-run span. Input spans
identify connections or default sources without recording input/output values. These boundaries
apply to every runtime using the shared executor, not just Cloudflare workflows.

For example, set these in `apps/server/.env` for development or production startup:

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=macrograph-server
# Optional for authenticated collectors:
# OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20your-token
```

For Docker, pass these as container environment variables and use a collector address reachable
from inside the container, such as `http://otel-collector:4318` on a shared Docker network.
Collector headers stay server-side and are not sent to the browser. Traces can contain request
metadata, errors, and execution attributes; send them only to a trusted collector.

## Container

The `Server image` GitHub Actions workflow publishes
`ghcr.io/brendonovich/macrograph-server:beta` on pushes to `main` (or a manual run on `main`).
It includes `linux/amd64` and `linux/arm64` images and publishes only the `beta` tag.
Pull requests build both architectures without publishing.
The old server's `main`, `latest`, and release tags are left untouched.

Because this reuses the old server's GHCR package, grant this repository write access under
the package's **Settings > Manage Actions access** before the first publish. The workflow
authenticates with `GITHUB_TOKEN`; no registry secret is needed.

```sh
docker run -d --name macrograph --restart unless-stopped \
  -p 3001:3001 -v macrograph-beta-data:/data \
  ghcr.io/brendonovich/macrograph-server:beta
```

Open `http://localhost:3001`. Use a separate data volume from the old server; this image is not
an in-place migration of its persisted data. To update, pull the image and recreate the container
with the same volume.

To build locally, run from the repository root:

```sh
docker build -f apps/server/Dockerfile -t macrograph:beta .
docker run --rm -p 3001:3001 -v macrograph-beta-data:/data macrograph:beta
```

The image runs as UID/GID `1000:1000`. Ensure a bind-mounted data directory is writable by that
identity; named volumes receive the image's `/data` ownership automatically.

MacroGraph authorization is stored separately from project data in
`MACROGRAPH_DATA_DIR/macrograph-auth.json`, which is atomically replaced with mode `0600` in a
mode `0700` directory. Opaque signed-in browser sessions are stored with the same protections in
`MACROGRAPH_DATA_DIR/macrograph-client-auth.json`. Anonymous browsers have read-only editor access;
only the signed-in server owner and configured admins may modify the project. Plugin configuration,
including OBS passwords, is stored in the ordinary project SQLite engine storage.

For a path prefix, build with `--build-arg MACROGRAPH_BASE_PATH=/macrograph` and run with the same
`MACROGRAPH_BASE_PATH`. Forward WebSocket upgrades for `rpc-ws`, preserve the public prefix, and
set `MACROGRAPH_PUBLIC_ORIGIN` to the external scheme and host. Do not rely on forwarded headers;
the server intentionally uses the explicit origin when generating public URLs.
