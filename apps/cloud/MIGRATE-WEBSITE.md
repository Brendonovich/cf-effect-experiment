# Website Cutover From Vercel

`www.macrograph.app` is moving from the Vercel project `macrograph` to `WebsiteWorker`, a
Cloudflare Worker in the `MacroGraph` stack. It serves the prebuilt site in
[`legacy-website/`](./legacy-website/README.md) and reimplements every server route of the
original app in [`src/website/WebsiteRoutes.ts`](./src/website/WebsiteRoutes.ts).

The account tables already live in the primary Cloud database (see
[`MIGRATE-ACCOUNT-DATABASE.md`](./MIGRATE-ACCOUNT-DATABASE.md)), so there is no data
migration. Both apps can safely serve traffic at the same time during the cutover.

## Compatibility

- **Sessions:** the `auth_session` cookie and `session` rows follow Lucia v3, including the
  30-day lifetime and extension in the second half of a session's life. Existing logins keep
  working.
- **Passwords:** Argon2id hashes use oslo's PHC format and parameters; existing hashes verify
  and new hashes remain readable by the original app.
- **Server JWTs:** registered servers hold RS256 JWTs signed with the original app's
  `JWT_PRIVATE_KEY`. The Worker must use the same key, or every registered server must
  reconnect.
- **OAuth:** providers have `https://macrograph.brendonovich.dev/auth/proxy` registered as the
  redirect URI (the original `AUTH_REDIRECT_PROXY_URL`). See [OAuth Proxy Host](#oauth-proxy-host).
- **Playground shares:** production adopts and retains the existing
  `macrograph-saved-shares` KV namespace.
- **Public API:** `/api/user`, `/api/credentials`, credential refresh, the device-code flow,
  server registration, `/api/cloud-login`, `/api/cloud-logout`, desktop downloads, and the
  `/auth/*` routes keep their paths, status codes, and response bodies.

Intentional changes: the web OAuth flow only posts tokens to MacroGraph or localhost origins,
OAuth state expires after an hour and is bound to its provider, credential connections are
bound to the signed-in user, device grants are single-use under concurrent polling, and
logging out also clears the session cookie.

## Cutover Record

**Completed on 2026-10-23.**

1. Copied the Vercel project's `JWT_PRIVATE_KEY` and `AUTH_SECRET` into the GitHub Actions
   secrets `WEBSITE_JWT_PRIVATE_KEY` and `WEBSITE_AUTH_SECRET`, and the Discord, Spotify,
   Google, Patreon, and Streamlabs client credentials into
   `WEBSITE_<PROVIDER>_CLIENT_ID`/`_CLIENT_SECRET`. `WEBSITE_`-prefixed values configure only
   `WebsiteWorker`; Twitch and GitHub fall back to Cloud's secrets.
2. Deployed `macrograph-website`, adopting the shares namespace.
3. Created the `macrograph.app` zone in Alchemy (`src/Dns.ts`) with the existing non-web records
   and temporary records pointing `www`, the apex, and `cloud` at their old hosts, then switched
   the domain's nameservers at Vercel (still the registrar) to Cloudflare.
4. Once the zone was active, replaced the temporary records with Worker custom domains:
   `www.macrograph.app` and `macrograph.app` on `WebsiteWorker`, `cloud.macrograph.app` on
   `CloudWorker`. Alchemy owns these through each Worker's `domain`, with the apex redirecting
   to `www`. The Pages gateways were deleted. Expect a few minutes of TLS errors on a new zone
   while Cloudflare validates its edge certificates.

## OAuth Proxy Host

Providers have `https://macrograph.brendonovich.dev/auth/proxy` registered as their redirect URI.
On 2026-10-24 `brendonovich.dev` also moved to Cloudflare: its zone and all of its records
(Proton Mail, Resend, the Vercel-hosted root and wildcard, and others) are managed in
`src/Dns.ts`, and `macrograph.brendonovich.dev` is a custom domain alias of `WebsiteWorker`.
`WebsiteWorker` still signs OAuth state with the original `AUTH_SECRET`, which keeps state issued
before the cutover valid but is otherwise only a secret.

## Rollback

Point the domains' nameservers back to Vercel's (`PATCH
/v1/registrar/domains/<domain>/nameservers` with an empty list) and restore the Vercel project. Both apps share the
database, session format, JWT key, and OAuth state secret, so sessions, credentials, and
registrations created on either side remain valid.

## Single Origin

Cloud moved from `cloud.macrograph.app` to `macrograph.app/cloud`, in the same layout as
opencode.ai: `WebsiteWorker` owns the stage's hostname (`src/PublicHost.ts`) as a Custom Domain
and serves anything no route claims, while `CloudWorker` claims `/cloud`, `/cloud/*` and the
`/.well-known/oauth-*/cloud` documents with Worker Routes (`src/api/CloudMount.ts`). Cloudflare runs
routes before the hostname's own Worker. Previews get `pr<N>.dev.macrograph.app` the same way.
`macrograph.app` is canonical; `www.macrograph.app` stays an alias so desktop and server API calls
keep working, and the Worker 301s browsers to the bare domain.

Cloud signs in with the website's `auth_session` cookie, so the two share one login. Cloud's
`users` rows already use website account IDs. `CloudAuthDO` and its per-session credential cache
are gone: deploying deletes the class, and project editors read the owner's credentials from the
account database instead. Cloud only lists credentials; they are connected and removed on the
website's `/account/credentials` page.

Before deploying:

1. Tell MCP users to reconnect with `https://macrograph.app/cloud/api/mcp`. Tokens issued for the
   old resource URL are no longer accepted.
