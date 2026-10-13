import { AppCredentials } from "@macrograph/module-twitch/EventSub/Webhook";
import { Config, Effect, Layer } from "effect";

export const ClientIdConfig = Config.String("TWITCH_CLIENT_ID");
export const ClientSecretConfig = Config.Redacted("TWITCH_CLIENT_SECRET");

const AppCredentialsConfig = Config.all({
  clientId: ClientIdConfig,
  clientSecret: ClientSecretConfig,
});

export const AppCredentialsLayer = Layer.effect(AppCredentials)(
  AppCredentialsConfig.pipe(Effect.orDie),
);
