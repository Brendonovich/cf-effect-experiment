import { AppCredentials } from "@macrograph/plugin-twitch/EventSub/Webhook";
import { Config, Effect, Layer } from "effect";

export const ClientIdConfig = Config.string("TWITCH_CLIENT_ID");
export const ClientSecretConfig = Config.redacted("TWITCH_CLIENT_SECRET");

const AppCredentialsConfig = Config.all({
  clientId: ClientIdConfig,
  clientSecret: ClientSecretConfig,
});

export const AppCredentialsLayer = Layer.effect(AppCredentials)(
  AppCredentialsConfig.pipe(Effect.orDie),
);
