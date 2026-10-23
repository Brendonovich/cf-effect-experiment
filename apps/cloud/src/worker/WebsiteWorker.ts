import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Context, Effect, Layer, Option, Redacted } from "effect";
import { HttpRouter } from "effect/http";

import * as OAuthProviders from "../auth/OAuthProviders.ts";
import * as Database from "../database/Database.ts";
import { ObservabilityLayer } from "../Observability.ts";
import { DatabaseHyperdrive, PlaygroundShares } from "../Storage.ts";
import * as Analytics from "../website/Analytics.ts";
import * as Jwt from "../website/Jwt.ts";
import * as WebsiteRoutes from "../website/WebsiteRoutes.ts";

/** Directory containing the prebuilt original website served at www.macrograph.app. */
export const websiteAssetsDirectory = new URL("../../legacy-website/public", import.meta.url)
  .pathname;

export class WebsiteOAuthStateSecret extends Context.Service<
  WebsiteOAuthStateSecret,
  Alchemy.Output<Redacted.Redacted<string>>
>()("WebsiteOAuthStateSecret") {}

/** Serves the original MacroGraph website and the account APIs used by desktop and servers. */
export class WebsiteWorker extends Cloudflare.Worker<WebsiteWorker, {}>()("WebsiteWorker") {}

const stateSecretKey = "WEBSITE_OAUTH_STATE_SECRET";
export const productionWorkerName = "macrograph-website";

export default Layer.unwrap(
  Effect.gen(function* () {
    const stateSecret = Option.getOrUndefined(yield* Effect.serviceOption(WebsiteOAuthStateSecret));
    // The stage only exists while deploying; at runtime, resources resolve by logical ID.
    const stage = Option.getOrUndefined(yield* Effect.serviceOption(Alchemy.Stage));
    const sharesNamespace = yield* PlaygroundShares(stage === "production");
    const databaseResource = yield* DatabaseHyperdrive;
    const environment = Object.fromEntries(
      [
        ...["TWITCH", "DISCORD", "GITHUB", "SPOTIFY", "GOOGLE", "PATREON", "STREAMLABS"].flatMap(
          (provider) => [`${provider}_CLIENT_ID`, `${provider}_CLIENT_SECRET`],
        ),
        "JWT_PRIVATE_KEY",
      ].flatMap((name) => {
        // `WEBSITE_`-prefixed values configure only this Worker, e.g. providers Cloud doesn't offer.
        const value = process.env[`WEBSITE_${name}`] || process.env[name] || undefined;
        if (value === undefined) return [];
        return [[name, name.endsWith("_CLIENT_ID") ? value : Redacted.make(value)] as const];
      }),
    );

    return WebsiteWorker.make(
      {
        // A stable production name lets the www.macrograph.app Pages gateway bind to it.
        ...(stage === "production" ? { name: productionWorkerName } : {}),
        main: import.meta.url,
        env: {
          ...environment,
          ...(process.env.WEBSITE_AUTH_REDIRECT_ORIGIN === undefined
            ? {}
            : { WEBSITE_AUTH_REDIRECT_ORIGIN: process.env.WEBSITE_AUTH_REDIRECT_ORIGIN }),
          ...(process.env.WEBSITE_ANALYTICS === undefined
            ? {}
            : { WEBSITE_ANALYTICS: process.env.WEBSITE_ANALYTICS }),
        },
        assets: {
          directory: websiteAssetsDirectory,
          notFoundHandling: "single-page-application",
          // Unlisted paths fall back to the SPA's index.html, so every worker route must be listed.
          runWorkerFirst: ["/api/*", "/auth/*"],
        },
        dev: { port: 1339, strictPort: true },
      },
      Effect.gen(function* () {
        const runtimeContext = yield* Alchemy.RuntimeContext;
        if (stateSecret !== undefined) yield* runtimeContext.set(stateSecretKey, stateSecret);
        const shares = yield* Cloudflare.KV.ReadWriteNamespace(sharesNamespace);
        const withRuntime = <A, E>(effect: Effect.Effect<A, E, Alchemy.RuntimeContext>) =>
          effect.pipe(Effect.provideService(Alchemy.RuntimeContext, runtimeContext), Effect.orDie);

        const stateKey = yield* Effect.cached(
          Effect.gen(function* () {
            const secret = yield* runtimeContext.get<Redacted.Redacted<string>>(stateSecretKey);
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
        const analytics = yield* Config.Boolean("WEBSITE_ANALYTICS").pipe(
          Config.withDefault(false),
        );

        const app = yield* WebsiteRoutes.layer({
          stateKey,
          serverKey,
          authRedirectOrigin,
          capture: analytics ? Analytics.posthog : Analytics.disabled,
          shares: {
            get: (id) => withRuntime(shares.get(id, "text")),
            put: (id, value) => withRuntime(shares.put(id, value)),
          },
        }).pipe(
          Layer.provide(OAuthProviders.layer),
          Layer.provide(Database.layer(databaseResource)),
          HttpRouter.toHttpEffect,
        );

        return { fetch: app };
      }).pipe(
        Effect.provide(Alchemy.RuntimeContext.phantom),
        Effect.provide(Cloudflare.Hyperdrive.ConnectBinding),
        Effect.provide(Cloudflare.KV.ReadWriteNamespaceBinding),
        Effect.provide(ObservabilityLayer),
      ),
    );
  }),
);
