# Cloud Domain

`cloud.macrograph.app` uses a Cloudflare Pages gateway to the production
`CloudWorker`. Pages supports custom subdomains with external DNS, unlike a
standard Workers custom domain. DNS stays on Vercel; the existing website and
other subdomains are unchanged.

The gateway forwards every request through the `CLOUD_WORKER` service binding,
including static assets, APIs, streaming responses, and WebSocket upgrades.
It does not redirect visitors to `workers.dev` or copy the frontend build.

A Vercel CDN rewrite was tested, but stripped the WebSocket `Upgrade` header.
The Pages service binding preserves upgrades and long-lived connections.

## Deployment

From `apps/cloudflare`, authenticate Wrangler to the same Cloudflare account as
Alchemy, then deploy the gateway:

```sh
pnpm exec wrangler login
pnpm run deploy:domain
```

Normal application updates still use Alchemy. The gateway only needs redeploying
when its code or binding changes. If Alchemy replaces or renames the production
`CloudWorker`, update `services[0].service` in `wrangler.jsonc` before redeploying.
Do not bind this gateway to a development stage.

## Initial Setup

The Pages project is named `macrograph-cloud`, with production branch `main`.
If recreating it, create the project before deploying:

```sh
pnpm exec wrangler pages project create macrograph-cloud --production-branch main
```

In Cloudflare, add `cloud.macrograph.app` under the Pages project's **Custom
domains**. Then create this record in Vercel's DNS settings for `macrograph.app`:

| Type  | Name  | Value                      |
| ----- | ----- | -------------------------- |
| CNAME | cloud | macrograph-cloud.pages.dev |

Register the custom domain in Pages before adding the CNAME. Cloudflare manages
the HTTPS certificate. No nameserver or registrar change is needed.
