# MacroGraph OAuth

`macrograph.app` is an OAuth 2.0 authorization server. Every MacroGraph client that acts for a
user (self-hosted servers, the browser playground, later the desktop app) signs in with the
**device authorization grant** and nothing else. One approval page, one token endpoint, one kind of
grant.

This replaces server registration codes, server JWTs, the old device-code endpoints and their
`mgu_`/`mgr_` tokens. Existing servers have to set up again.

## Standards

| Spec                                                             | Used for                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| RFC 6749 (OAuth 2.0)                                             | Token endpoint, client authentication, error responses, refresh grant              |
| RFC 8628 (Device Authorization Grant)                            | The only user-facing flow                                                          |
| RFC 7591 / RFC 7592 (Dynamic Client Registration and Management) | Servers register themselves                                                        |
| RFC 7009 (Token Revocation)                                      | Sign out, disconnect                                                               |
| RFC 6750 (Bearer Token Usage)                                    | Calling `/api/credentials` and UserInfo                                            |
| RFC 8414 (Authorization Server Metadata)                         | Discovery                                                                          |
| RFC 7517 / RFC 7638 (JWK, JWK Thumbprint)                        | Signing keys and `kid`                                                             |
| RFC 9700 (OAuth 2.0 Security BCP)                                | Refresh token rotation and reuse detection                                         |
| OpenID Connect Core 1.0                                          | ID token format and validation, UserInfo, `openid`/`email`/`offline_access` scopes |

We are **not** an OpenID Provider: OpenID Connect requires the authorization endpoint, which we do
not have. ID tokens, UserInfo and claims follow OpenID Connect exactly, but we publish only RFC
8414 metadata, not `/.well-known/openid-configuration`.

## Issuer and endpoints

The issuer is `https://macrograph.app` in production. Other stages use the request origin (the
preview's workers.dev URL, or localhost). Metadata is served without a path suffix, so it does not
collide with Cloud's `/.well-known/oauth-authorization-server/cloud`. Every endpoint lives under
`/api/`, which WebsiteWorker claims with a Worker Route; only the metadata document sits at the root,
where RFC 8414 requires it. `/device` is a page, served by the website's own Worker.

| Endpoint             | Path                                                  |
| -------------------- | ----------------------------------------------------- |
| Metadata             | `GET /.well-known/oauth-authorization-server`         |
| JWKS                 | `GET /api/oauth/jwks`                                 |
| Registration         | `POST /api/oauth/register`                            |
| Client configuration | `GET`, `PUT`, `DELETE /api/oauth/register/:client_id` |
| Device authorization | `POST /api/oauth/device_authorization`                |
| Token                | `POST /api/oauth/token`                               |
| Revocation           | `POST /api/oauth/revoke`                              |
| UserInfo             | `GET`, `POST /api/oauth/userinfo`                     |
| Verification page    | `/device` (`?user_code=` pre-fills it)                |

Everything under `/api/oauth/` and the metadata allow any origin (CORS `*`, no cookies), because the
playground calls them from the browser. Requests are `application/x-www-form-urlencoded` except
registration, which is JSON as RFC 7591 requires. Token, device and registration responses carry
`Cache-Control: no-store` and `Pragma: no-cache`.

## Clients

**Registered clients (servers).** On first start a server calls `POST /api/oauth/register`:

```json
{
  "client_name": "Brendan's server",
  "grant_types": ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
  "token_endpoint_auth_method": "client_secret_basic",
  "software_id": "macrograph-server",
  "software_version": "0.1.0"
}
```

It gets `client_id`, `client_secret`, `registration_access_token` and `registration_client_uri`,
and stores them in its data directory. They are confidential clients: every device and token
request authenticates with HTTP Basic (`client_secret_post` is also accepted). Only the device and
refresh grants may be registered; `redirect_uris` and `response_types` must be absent or empty.

Registration is open, so it is rate limited per IP, and clients that never get a grant are deleted
after 30 days. A server that gets `invalid_client` registers again.

**Public clients.** Built in, no secret, `token_endpoint_auth_method: none`:

| `client_id`             | Name                  |
| ----------------------- | --------------------- |
| `macrograph-playground` | MacroGraph Playground |

## Scopes

| Scope            | Grants                                                                 |
| ---------------- | ---------------------------------------------------------------------- |
| `openid`         | An ID token (`sub`) and UserInfo                                       |
| `email`          | `email` and `email_verified` claims                                    |
| `offline_access` | A refresh token, so the grant outlives the access token                |
| `credentials`    | Read and refresh the user's connected credentials (`/api/credentials`) |

Signing in to a server asks for `openid email`. Connecting a server's owner, or the playground,
asks for `openid email offline_access credentials`.

## Device flow

1. The client calls `POST /api/oauth/device_authorization` with `scope` (and its client
   authentication). The response has `device_code`, `user_code`, `verification_uri`
   (`https://macrograph.app/device`), `verification_uri_complete`, `expires_in` (600) and
   `interval` (5).
2. The client shows the user code and a link to `verification_uri_complete`.
3. On `/device` the user signs in if needed, enters or confirms the code, and sees the client's
   name (marked unverified for registered clients), the requested scopes in plain language, and
   where the request came from (IP and country). They approve or deny.
4. The client polls `POST /api/oauth/token` with
   `grant_type=urn:ietf:params:oauth:grant-type:device_code` and gets `authorization_pending`,
   `slow_down` (polling faster than `interval`; the interval grows by 5 seconds), `access_denied`,
   `expired_token`, or tokens. A device code works once.

User codes are 8 characters from `BCDFGHJKLMNPQRSTVWXZ` (RFC 8628 §6.1), shown as `XXXX-XXXX`, and
matched ignoring case and punctuation. Failed code lookups are rate limited per user.

## Tokens

The token response is the RFC 6749 shape plus `id_token` when `openid` was granted:
`access_token`, `token_type: "Bearer"`, `expires_in`, `scope`, `refresh_token` (only with
`offline_access`), `id_token`.

| Token                             | Format          | Lifetime                     | Stored       |
| --------------------------------- | --------------- | ---------------------------- | ------------ |
| Access token                      | opaque `mgat_…` | 1 hour                       | SHA-256 hash |
| Refresh token                     | opaque `mgrt_…` | 90 days, renewed on each use | SHA-256 hash |
| ID token                          | RS256 JWT       | 5 minutes                    | not stored   |
| Device code                       | opaque          | 10 minutes                   | SHA-256 hash |
| Client secret, registration token | opaque          | until rotated or deleted     | SHA-256 hash |

Access tokens are opaque so revocation takes effect immediately.

**Refresh rotation.** Every refresh returns a new refresh token and retires the old one. Presenting
a retired refresh token revokes the whole grant (RFC 9700 §4.14.2). The refreshed response also
carries a new ID token with the same `sub`, `aud` and `iss` (OpenID Connect Core §12.2). A refresh
may narrow the scope but never widen it.

**ID token claims:** `iss`, `sub` (the account ID), `aud` (the `client_id`), `exp`, `iat`, and with
`email` scope `email` and `email_verified` (always `false`: addresses are not verified yet).
Signed with a 2048-bit RSA key that each stage generates once and keeps in its alchemy state
(`WebsiteSigningKey`); `kid` is its RFC 7638 thumbprint, published at `/api/oauth/jwks`.
Clients validate them per OpenID Connect Core §3.1.3.7: signature, `iss`, `aud` contains their
`client_id`, `azp` when there are several audiences, `exp`, and `iat`.

## Grants

Each approval creates one grant: client, user, scope. A grant with `offline_access` lives as long
as its refresh token chain; one without ends when its access token expires.

**Account → Servers** lists the user's grants that hold `credentials`, grouped by client, with the
client's name, when it was approved, and when it was last used. Removing one revokes the grant and
every token issued from it. Revoking a refresh token through `/api/oauth/revoke` does the same; revoking
an access token revokes only that token.

## Resource access

`/api/credentials` and `/api/credentials/:provider/:id/refresh` accept `Authorization: Bearer
mgat_…` with the `credentials` scope. Failures use RFC 6750 errors (`invalid_token` with 401,
`insufficient_scope` with 403) and a `WWW-Authenticate` header. OAuth clients receive provider
access tokens only, never provider refresh tokens.

The desktop app still sends its website session ID as a bearer token until it moves to this flow.

## Self-hosted servers

- **Registration:** automatic, on first start, as above.
- **Claiming:** the first owner proves access to the machine with the setup key printed at startup,
  then approves a device flow for `openid email offline_access credentials`. Their `sub` becomes the
  owner, and the refresh token is the server's link to their credentials.
- **Signing in:** anyone runs a device flow for `openid email`. The server validates the ID token,
  creates its own session from `sub` and `email`, and revokes the access token. Owner and admins
  can edit; others are read-only.
- **Reconnecting:** when the owner's grant is revoked or lapses, the owner signs in normally and
  reconnects from settings. Only the owner's `sub` is accepted.

## Database

All in the account schema (`src/database/AccountDatabaseSchema.ts`):

| Table                        | Holds                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `auth_clients`               | Registered clients: hashed secret and registration token, metadata, created IP                                                        |
| `auth_device_authorizations` | Pending device flows: hashed device code, user code, client, scope, status, user, interval, last poll, expiry, request IP and country |
| `auth_grants`                | Client, user, scope, created, last used, expiry                                                                                       |
| `auth_refresh_tokens`        | Hashed token, grant, expiry, when it was retired                                                                                      |
| `auth_access_tokens`         | Hashed token, grant, scope, expiry                                                                                                    |
| `auth_rate_limits`           | Fixed-window counters for registration and code lookups                                                                               |

Grants cascade to their tokens. Deleting a client deletes its grants and device flows in the same
transaction (no foreign key, since built-in public clients have no row).

## Preview deployments

Pull request previews (`pr<number>` stages) only let in the account IDs listed in the
`PREVIEW_ALLOWED_USERS` GitHub Actions variable (comma-separated); an empty list lets nobody in.
WebsiteWorker and Cloud have no workers.dev URLs on previews; the website's own Worker is the only
public entry. It forwards API paths to WebsiteWorker, which gates them, and asks WebsiteWorker for a
gate decision (`x-macrograph-preview-gate`, answered 204 when allowed) before rendering a page or
forwarding to Cloud.
Ingress stays public so provider webhooks still arrive.

1. A visitor without a valid `macrograph_preview` cookie is redirected to
   `https://macrograph.app/auth/preview?origin=<preview origin>&next=<path>`. Other methods get 401.
2. Production signs them in if needed, then redirects to `<preview origin>/auth/preview/callback`
   with a grant: an RS256 JWT (`typ: preview-grant+jwt`) signed with `WebsiteSigningKey`, with
   `iss` `https://macrograph.app`, `aud` the preview origin, `sub` the account ID, and a 60 second
   lifetime. It only redirects to `https://macrograph-website-pr<n>-*.brendonovich.workers.dev`.
3. The preview verifies the grant against `https://macrograph.app/api/oauth/jwks`, checks `sub` against
   its allowlist, and sets its own HMAC-signed cookie for 7 days.
