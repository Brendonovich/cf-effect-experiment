import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import { Config, Context, Effect, Layer, Option, Redacted } from "effect";
import { FetchHttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as OAuthProviders from "../auth/OAuthProviders.ts";
import * as Database from "../database/Database.ts";
import * as EarlyAccess from "../EarlyAccess.ts";
import { Gateway } from "../gateway/Gateway.ts";
import { ObservabilityLayer } from "../Observability.ts";
import * as PublicHost from "../PublicHost.ts";
import { DatabaseHyperdrive } from "../Storage.ts";
import * as Analytics from "../website/Analytics.ts";
import { GatewayRoutes } from "../website/GatewayRoutes.ts";
import * as Jwt from "../website/Jwt.ts";
import * as PreviewAuth from "../website/PreviewAuth.ts";
import * as WebsiteRoutes from "../website/WebsiteRoutes.ts";

export class WebsiteOAuthStateSecret extends Context.Service<
  WebsiteOAuthStateSecret,
  Alchemy.Output<Redacted.Redacted<string>>
>()("WebsiteOAuthStateSecret") {}

/** PEM PKCS#8 RSA key that signs OAuth ID tokens, generated once per stage. */
export class WebsiteSigningKey extends Context.Service<
  WebsiteSigningKey,
  Alchemy.Output<Redacted.Redacted<string>>
>()("WebsiteSigningKey") {}

/**
 * The account API: sessions, credentials, the OAuth authorization server (`OAUTH.md`), and the
 * provider OAuth flows used by desktop apps. Pages are served by the website's own Worker
 * (`apps/website`), which forwards API paths here in stages without Worker Routes.
 */
export class WebsiteWorker extends Cloudflare.Worker<WebsiteWorker, {}>()("WebsiteWorker") {}

const stateSecretKey = "WEBSITE_OAUTH_STATE_SECRET";
const signingKeyKey = "WEBSITE_OAUTH_SIGNING_KEY";
export const productionWorkerName = "macrograph-website";

export default Layer.unwrap(
  Effect.gen(function* () {
    const stateSecret = Option.getOrUndefined(yield* Effect.serviceOption(WebsiteOAuthStateSecret));
    const signingKeyPem = Option.getOrUndefined(yield* Effect.serviceOption(WebsiteSigningKey));
    // `Stack` is available both while deploying and at runtime, so the props match in each.
    const { stage } = yield* Alchemy.Stack;
    const dev = yield* EarlyAccess.isDev;
    const databaseResource = yield* DatabaseHyperdrive;
    const environment = Object.fromEntries(
      [
        ...["TWITCH", "DISCORD", "GITHUB", "SPOTIFY", "GOOGLE", "PATREON", "STREAMLABS"].flatMap(
          (provider) => [`${provider}_CLIENT_ID`, `${provider}_CLIENT_SECRET`],
        ),
        "AUTH_SECRET",
      ].flatMap((name) => {
        // `WEBSITE_`-prefixed values configure only this Worker, e.g. providers Cloud doesn't offer.
        const value = process.env[`WEBSITE_${name}`] || process.env[name] || undefined;
        if (value === undefined) return [];
        // Bound values are JSON-decoded at runtime, turning numeric client IDs (such as Discord's)
        // into numbers. Alchemy's Redacted marker always decodes back to the original string.
        return [[name, Redacted.make(JSON.stringify({ _tag: "Redacted", value }))] as const];
      }),
    );

    const publicHost = PublicHost.forStage(stage);
    return WebsiteWorker.make(
      {
        ...(stage === "production" ? { name: productionWorkerName } : {}),
        // Previews reach the API only through the website's Worker, which asks the gate first.
        ...(PublicHost.isPreviewStage(stage) ? { workersDev: false } : {}),
        ...(publicHost === undefined
          ? // Explicitly detach: omitting `domain` would leave a previously attached one in place.
            { domain: null }
          : {
              // The OAuth redirect host every provider has registered (`/auth/proxy`).
              domain: { name: PublicHost.authRedirectHost },
              // API paths on the site's hostnames. Desktop apps and servers also call the API on
              // the legacy hosts, which the site would otherwise redirect.
              routes: [publicHost, ...PublicHost.legacyBrowserHosts].flatMap((hostname) =>
                PublicHost.apiRoutePatterns(hostname).map((pattern) => ({ pattern })),
              ),
            }),
        main: import.meta.url,
        env: {
          ...environment,
          GATEWAY_ALLOWED_USERS: process.env.GATEWAY_ALLOWED_USERS ?? "",
          ...(PublicHost.isPreviewStage(stage)
            ? { PREVIEW_ALLOWED_USERS: process.env.PREVIEW_ALLOWED_USERS ?? "" }
            : {}),
          ...(dev ? { WEBSITE_DEV_SIGN_IN: "1" } : {}),
          ...(process.env.WEBSITE_AUTH_REDIRECT_ORIGIN === undefined
            ? {}
            : { WEBSITE_AUTH_REDIRECT_ORIGIN: process.env.WEBSITE_AUTH_REDIRECT_ORIGIN }),
        },
        dev: { port: 1339, strictPort: true },
      },
      Effect.gen(function* () {
        const runtimeContext = yield* Alchemy.RuntimeContext;
        if (stateSecret !== undefined) yield* runtimeContext.set(stateSecretKey, stateSecret);
        if (signingKeyPem !== undefined) yield* runtimeContext.set(signingKeyKey, signingKeyPem);

        const stateKey = yield* Effect.cached(
          Effect.gen(function* () {
            // The original website's AUTH_SECRET lets its still-registered OAuth proxy host verify
            // state signed here; other stages use a generated secret.
            const authSecret = yield* Config.option(Config.Redacted("AUTH_SECRET")).pipe(
              Effect.orDie,
            );
            const secret = Option.isSome(authSecret)
              ? authSecret.value
              : yield* runtimeContext.get<Redacted.Redacted<string>>(stateSecretKey);
            if (secret === undefined)
              return yield* Effect.die("Website OAuth state secret is unavailable");
            return yield* Jwt.hmacKey(Redacted.value(secret));
          }),
        );
        const signingKey = yield* Effect.cached(
          Effect.gen(function* () {
            const pem = yield* runtimeContext.get<Redacted.Redacted<string>>(signingKeyKey);
            if (pem === undefined) return yield* Effect.die("Website signing key is unavailable");
            return yield* Jwt.rsaKey(Redacted.value(pem));
          }).pipe(Effect.orDie),
        );
        // A configured origin (such as a dev tunnel) serves every provider. Otherwise providers use
        // the original website's AUTH_REDIRECT_PROXY_URL, unless they've registered the main site.
        const configuredRedirectOrigin = yield* Config.option(
          Config.String("WEBSITE_AUTH_REDIRECT_ORIGIN"),
        );
        const authRedirectOrigin = Option.getOrElse(
          configuredRedirectOrigin,
          () => `https://${PublicHost.authRedirectHost}`,
        );

        const previewGate = PublicHost.isPreviewStage(stage)
          ? PreviewAuth.makeGate({
              allowedUsers: new Set(
                (yield* Config.String("PREVIEW_ALLOWED_USERS").pipe(Config.withDefault("")))
                  .split(",")
                  .map((id) => id.trim())
                  .filter((id) => id !== ""),
              ),
              cookieKey: stateKey,
            })
          : undefined;

        const app = yield* Layer.mergeAll(
          WebsiteRoutes.layer({
            stateKey,
            signingKey,
            ...(publicHost === undefined ? {} : { issuer: `https://${publicHost}` }),
            authRedirectOrigin,
            ...(Option.isNone(configuredRedirectOrigin)
              ? { providerRedirectOrigins: PublicHost.providerRedirectOrigins }
              : {}),
            preview: PublicHost.isPreviewStage(stage),
            devSignIn:
              (yield* Config.String("WEBSITE_DEV_SIGN_IN").pipe(Config.withDefault(""))) === "1",
            capture: stage === "production" ? Analytics.posthog : Analytics.disabled,
          }),
          GatewayRoutes.layer,
        ).pipe(
          Layer.provide(Gateway.layer.pipe(Layer.provide(FetchHttpClient.layer))),
          Layer.provide(OAuthProviders.layer),
          Layer.provide(Database.layer(databaseResource)),
          HttpRouter.toHttpEffect,
        );

        // Only API paths reach this Worker: Worker Routes in production, the website's Worker
        // forwarding them otherwise. Previews gate every request first (see `PreviewAuth.ts`).
        if (previewGate === undefined) return { fetch: app };
        return {
          fetch: Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const source = request.source;
            if (!(source instanceof Request)) return HttpServerResponse.empty({ status: 403 });
            const denied = yield* previewGate(request, new URL(source.url));
            if (denied !== undefined) return denied;
            // The website's Worker asks before rendering a page or forwarding to Cloud.
            if (request.headers[PreviewAuth.gateCheckHeader] !== undefined)
              return HttpServerResponse.empty({ status: 204 });
            return yield* app;
          }),
        };
      }).pipe(
        Effect.provide(Alchemy.RuntimeContext.phantom),
        Effect.provide(Cloudflare.Hyperdrive.ConnectBinding),
        Effect.provide(ObservabilityLayer),
      ),
    );
  }),
);
