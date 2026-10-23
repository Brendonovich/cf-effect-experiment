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
  redirect URI (the original `AUTH_REDIRECT_PROXY_URL`). The Worker uses this by default, so
  that hostname must also be routed to the Worker. Override it with
  `WEBSITE_AUTH_REDIRECT_ORIGIN` only after registering the new URI with every provider.
- **Playground shares:** production adopts and retains the existing
  `macrograph-saved-shares` KV namespace.
- **Public API:** `/api/user`, `/api/credentials`, credential refresh, the device-code flow,
  server registration, `/api/cloud-login`, `/api/cloud-logout`, desktop downloads, and the
  `/auth/*` routes keep their paths, status codes, and response bodies.

Intentional changes: the web OAuth flow only posts tokens to MacroGraph or localhost origins,
OAuth state expires after an hour and is bound to its provider, credential connections are
bound to the signed-in user, device grants are single-use under concurrent polling, and
logging out also clears the session cookie.

## Steps

1. Copy the Vercel project's `JWT_PRIVATE_KEY` into the GitHub Actions secret
   `WEBSITE_JWT_PRIVATE_KEY`, and the Discord, Spotify, Google, Patreon, and Streamlabs client
   credentials into `WEBSITE_<PROVIDER>_CLIENT_ID`/`_CLIENT_SECRET`. `WEBSITE_`-prefixed
   values configure only `WebsiteWorker`; Twitch and GitHub fall back to Cloud's secrets. Do
   not print them.
2. Merge to `main`. The production deploy creates the `macrograph-website` Worker and adopts
   the shares namespace. Check the plan reports an adoption, not a new namespace.
3. Smoke-test the Worker's `workers.dev` URL (the `websiteWorkerUrl` stack output): the landing
   page, `/api/user`, `/api/desktop/download/latest/windows-x86_64`, and an existing share.
   Login cookies are host-specific, so sign-in testing waits for the real domain.
4. Create the `macrograph-www` Pages gateway and deploy it from `apps/cloud`:

   ```sh
   pnpm exec wrangler pages project create macrograph-www --production-branch main
   pnpm run deploy:website-domain
   ```

5. In the Pages project, add the custom domains `www.macrograph.app` and
   `macrograph.brendonovich.dev`. Then, in Vercel DNS, replace each record with a CNAME to
   `macrograph-www.pages.dev`, and remove the domains from the Vercel project.
6. After DNS propagates, verify on `www.macrograph.app`: an existing session, password login,
   signup, connecting and removing a credential, desktop OAuth, server registration, device
   login, Cloud sign-in on `cloud.macrograph.app`, and a self-hosted server's credential
   refresh.
7. Pause the Vercel project once no traffic reaches it.

## Apex Domain

Pages only supports apex custom domains on Cloudflare-managed zones. While `macrograph.app`
uses Vercel DNS, its apex redirect to `www` stays on Vercel. Removing Vercel entirely requires
moving the zone's nameservers to Cloudflare, then serving or redirecting the apex there. With
the zone on Cloudflare, Worker custom domains can replace both Pages gateways.

## Rollback

Point the DNS records back to Vercel. Both apps share the database and session format, so
sessions, credentials, and registrations created on either side remain valid. Server JWTs
issued by the Worker are only valid on Vercel if both use the same `JWT_PRIVATE_KEY`.
