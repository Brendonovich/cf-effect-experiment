import { AppCredentials } from "@macrograph/module-github/AppApi";
import { Config, Effect, Layer } from "effect";

export const AppIdConfig = Config.string("GITHUB_APP_ID");
export const PrivateKeyConfig = Config.redacted("GITHUB_APP_PRIVATE_KEY");

export const AppCredentialsLayer = Layer.effect(AppCredentials)(
  Config.all({ appId: AppIdConfig, privateKey: PrivateKeyConfig }).pipe(Effect.orDie),
);
