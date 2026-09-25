import { AppCredentials } from "@macrograph/module-github/AppApi";
import { Config, Effect, Layer, Redacted } from "effect";

export const AppIdConfig = Config.string("GITHUB_APP_ID");
export const PrivateKeyConfig = Config.redacted("GITHUB_APP_PRIVATE_KEY");

export const AppCredentialsLayer = Layer.effect(AppCredentials)(
  Config.all({ appId: AppIdConfig, privateKey: PrivateKeyConfig }).pipe(Effect.orDie),
);

export const appCredentialsLayerFromEnvironment = (
  environment: Readonly<Record<string, unknown>>,
) =>
  Layer.effect(AppCredentials)(
    Effect.gen(function* () {
      const appId = environment.GITHUB_APP_ID;
      const privateKey = environment.GITHUB_APP_PRIVATE_KEY;
      if (typeof appId !== "string" || appId === "")
        return yield* Effect.die("GITHUB_APP_ID is unavailable");
      if (typeof privateKey !== "string" || privateKey === "")
        return yield* Effect.die("GITHUB_APP_PRIVATE_KEY is unavailable");
      return { appId, privateKey: Redacted.make(privateKey) };
    }),
  );
