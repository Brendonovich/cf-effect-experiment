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

- `PORT` and `HOST`: listener, default `3001` and `0.0.0.0`.
- `MACROGRAPH_DATA_DIR`: persistent SQLite directory, default current directory; mount `/data` in the image.
- `MACROGRAPH_CLOUD_BASE_URL`: MacroGraph credential service base, default exactly
  `https://www.macrograph.app/api`. The legacy no-`www` origin is normalized automatically.
- `MACROGRAPH_ADMIN_IDS`: optional comma-separated MacroGraph user IDs that may edit this server's
  project in addition to the account that registered the server.
- `MACROGRAPH_BASE_PATH`: public path such as `/macrograph`. Set it at both image build and runtime.
- `MACROGRAPH_PUBLIC_ORIGIN`: externally visible HTTP(S) origin, without a path, used by the
  browser security policy. Set this when running behind a reverse proxy.
- `OTEL_EXPORTER_OTLP_ENDPOINT`: optional server OTLP/HTTP trace endpoint.
- `VITE_OTEL_EXPORTER_OTLP_ENDPOINT`: optional browser OTLP/HTTP trace endpoint, set at build time.
- `MACROGRAPH_BROWSER_OTLP_ENDPOINT`: browser collector URL used by the runtime CSP; the image sets
  this from the browser build argument.

Browser tracing is disabled unless its endpoint is configured. Cross-origin collectors must allow
the application origin, `POST`, and the `Content-Type` request header. The server CSP adds only the
configured collector and public WebSocket origins to `connect-src`; reverse proxies that replace
CSP must preserve those sources. Do not put collector credentials in the browser endpoint URL.

## Container

```sh
docker build -f apps/server/Dockerfile -t macrograph .
docker run --rm -p 3001:3001 -v macrograph-data:/data macrograph
```

The image runs as UID/GID `1000:1000`. Ensure a bind-mounted data directory is writable by that
identity; named volumes receive the image's `/data` ownership automatically.

MacroGraph authorization is stored separately from project data in
`MACROGRAPH_DATA_DIR/macrograph-auth.json`, which is atomically replaced with mode `0600` in a
mode `0700` directory. Opaque signed-in browser sessions are stored with the same protections in
`MACROGRAPH_DATA_DIR/macrograph-client-auth.json`. Anonymous browsers have read-only editor access;
the server registration owner and configured admins may modify the project. Plugin configuration,
including OBS passwords, is stored in the ordinary project SQLite engine storage.

For a path prefix, build with `--build-arg MACROGRAPH_BASE_PATH=/macrograph` and run with the same
`MACROGRAPH_BASE_PATH`. Forward WebSocket upgrades for `rpc-ws`, preserve the public prefix, and
set `MACROGRAPH_PUBLIC_ORIGIN` to the external scheme and host. Do not rely on forwarded headers;
the server intentionally uses the explicit origin when generating public URLs.
