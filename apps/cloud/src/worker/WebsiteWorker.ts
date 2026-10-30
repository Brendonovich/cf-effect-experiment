import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Output from "alchemy/Output";
import { Config, Context, Effect, Layer, Option, Redacted } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as CloudMount from "../api/CloudMount.ts";
import * as OAuthProviders from "../auth/OAuthProviders.ts";
import * as Database from "../database/Database.ts";
import { ObservabilityLayer } from "../Observability.ts";
import * as PublicHost from "../PublicHost.ts";
import { DatabaseHyperdrive } from "../Storage.ts";
import * as Analytics from "../website/Analytics.ts";
import * as Jwt from "../website/Jwt.ts";
import * as WebsiteRoutes from "../website/WebsiteRoutes.ts";
import { CloudWorker } from "./CloudWorker.ts";

/** The built `apps/website` app served at macrograph.app. Omitted while developing. */
export class WebsiteAssetsDirectory extends Context.Service<
  WebsiteAssetsDirectory,
  Alchemy.Output<string> | undefined
>()("WebsiteAssetsDirectory") {}

export class WebsiteOAuthStateSecret extends Context.Service<
  WebsiteOAuthStateSecret,
  Alchemy.Output<Redacted.Redacted<string>>
>()("WebsiteOAuthStateSecret") {}

/**
 * Serves the MacroGraph website and the account APIs used by desktop and servers. It owns the
 * stage's hostname as a Custom Domain; Cloud claims `/cloud` on it with Worker Routes.
 */
export class WebsiteWorker extends Cloudflare.Worker<WebsiteWorker, {}>()("WebsiteWorker") {}

const stateSecretKey = "WEBSITE_OAUTH_STATE_SECRET";
export const productionWorkerName = "macrograph-website";

export default Layer.unwrap(
  Effect.gen(function* () {
    const stateSecret = Option.getOrUndefined(yield* Effect.serviceOption(WebsiteOAuthStateSecret));
    // `Stack` is available both while deploying and at runtime, so the props match in each.
    const { stage } = yield* Alchemy.Stack;
    const assetsDirectory = Option.getOrUndefined(
      yield* Effect.serviceOption(WebsiteAssetsDirectory),
    );
    const databaseResource = yield* DatabaseHyperdrive;
    const environment = Object.fromEntries(
      [
        ...["TWITCH", "DISCORD", "GITHUB", "SPOTIFY", "GOOGLE", "PATREON", "STREAMLABS"].flatMap(
          (provider) => [`${provider}_CLIENT_ID`, `${provider}_CLIENT_SECRET`],
        ),
        "JWT_PRIVATE_KEY",
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
        ...(publicHost === undefined
          ? {}
          : {
              domain: {
                name: publicHost,
                aliases:
                  stage === "production"
                    ? [
                        // Desktop apps and servers call the account API here, so it must not
                        // 301: that would turn their POSTs into GETs. Browsers are redirected
                        // by the Worker instead.
                        ...PublicHost.legacyBrowserHosts,
                        // The OAuth redirect host every provider has registered (`/auth/proxy`).
                        "macrograph.brendonovich.dev",
                      ]
                    : [],
              },
            }),
        main: import.meta.url,
        env: {
          ...environment,
          ...(process.env.WEBSITE_AUTH_REDIRECT_ORIGIN === undefined
            ? {}
            : { WEBSITE_AUTH_REDIRECT_ORIGIN: process.env.WEBSITE_AUTH_REDIRECT_ORIGIN }),
        },
        assets: assetsDirectory
          ? Output.map(assetsDirectory, (directory) => ({
              directory,
              htmlHandling: "auto-trailing-slash",
              notFoundHandling: "single-page-application",
              // Every request reaches the worker first so legacy hosts can redirect browsers; it
              // serves pages from the ASSETS binding.
              runWorkerFirst: true,
            }))
          : undefined,
        dev: { port: 1339, strictPort: true },
      },
      Effect.gen(function* () {
        const runtimeContext = yield* Alchemy.RuntimeContext;
        if (stateSecret !== undefined) yield* runtimeContext.set(stateSecretKey, stateSecret);
        // Without a dedicated hostname there are no Worker Routes (they only run on zones we own),
        // so this Worker forwards Cloud's paths and its workers.dev URL serves both apps.
        const cloud =
          publicHost === undefined ? yield* Cloudflare.Workers.bindWorker(CloudWorker) : undefined;

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
        const serverKey = yield* Effect.cached(
          Effect.gen(function* () {
            const pem = yield* Config.option(Config.Redacted("JWT_PRIVATE_KEY"));
            if (Option.isNone(pem)) return undefined;
            return yield* Jwt.rsaKey(Redacted.value(pem.value));
          }).pipe(Effect.orDie),
        );
        const authRedirectOrigin = yield* Config.String("WEBSITE_AUTH_REDIRECT_ORIGIN").pipe(
          // The original website's AUTH_REDIRECT_PROXY_URL, registered with every OAuth provider.
          Config.withDefault("https://macrograph.brendonovich.dev"),
        );

        const app = yield* WebsiteRoutes.layer({
          stateKey,
          serverKey,
          authRedirectOrigin,
          capture: stage === "production" ? Analytics.posthog : Analytics.disabled,
        }).pipe(
          Layer.provide(OAuthProviders.layer),
          Layer.provide(Database.layer(databaseResource)),
          HttpRouter.toHttpEffect,
        );

        return {
          fetch: Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const source = request.source;
            if (!(source instanceof Request)) return yield* app;
            const url = new URL(source.url);
            if (cloud !== undefined && CloudMount.claims(url.pathname)) {
              const environment = yield* Cloudflare.WorkerEnvironment;
              // `bindWorker` names the service binding after the Worker's logical ID.
              const binding: { fetch: (request: Request) => Promise<Response> } | undefined =
                environment.CloudWorker;
              if (binding === undefined) return HttpServerResponse.empty({ status: 503 });
              // The full path and host go through unchanged; CloudWorker strips the mount itself.
              const response = yield* Effect.promise(() => binding.fetch(source));
              // A raw body passes the native response through untouched, including WebSockets.
              return HttpServerResponse.raw(response, { status: response.status });
            }
            const isApi = url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/");
            if (isApi) return yield* app;
            if (
              PublicHost.legacyBrowserHosts.has(url.hostname) &&
              (request.method === "GET" || request.method === "HEAD")
            )
              return HttpServerResponse.redirect(
                `https://${PublicHost.zoneName}${url.pathname}${url.search}`,
                { status: 301 },
              );
            const environment = yield* Cloudflare.WorkerEnvironment;
            const assets: { fetch: (request: Request) => Promise<Response> } | undefined =
              environment.ASSETS;
            if (assets === undefined) return HttpServerResponse.empty({ status: 404 });
            const response = yield* Effect.promise(() => assets.fetch(source));
            return HttpServerResponse.raw(response, { status: response.status });
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
