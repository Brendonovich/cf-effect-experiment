import { Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect";

import type { OAuthToken } from "../database/AccountDatabaseSchema.ts";

export class ProviderError extends Schema.TaggedError<ProviderError>()("OAuthProviderError", {
  message: Schema.String,
}) {}

interface ProviderDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scopes: ReadonlyArray<string>;
  readonly authorizeParams?: Readonly<Record<string, string>>;
  readonly tokenHeaders?: (
    clientId: string,
    clientSecret: string,
  ) => Readonly<Record<string, string>>;
  readonly refresh: boolean;
  readonly user: (
    accessToken: string,
    clientId: string,
  ) => Promise<{
    readonly id: string;
    readonly displayName: string;
  }>;
}

export interface Provider extends ProviderDefinition {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
}

const twitchScopes = [
  "bits:read",
  "channel:edit:commercial",
  "channel:manage:broadcast",
  "channel:manage:moderators",
  "channel:manage:polls",
  "channel:manage:predictions",
  "channel:manage:raids",
  "channel:manage:redemptions",
  "channel:manage:schedule",
  "channel:manage:videos",
  "channel:manage:vips",
  "channel:moderate",
  "channel:read:editors",
  "channel:read:goals",
  "channel:read:hype_train",
  "channel:read:polls",
  "channel:read:predictions",
  "channel:read:redemptions",
  "channel:read:stream_key",
  "channel:read:subscriptions",
  "channel:read:vips",
  "channel:read:ads",
  "chat:edit",
  "chat:read",
  "clips:edit",
  "moderation:read",
  "moderator:manage:announcements",
  "moderator:manage:automod_settings",
  "moderator:manage:automod",
  "moderator:manage:banned_users",
  "moderator:manage:chat_messages",
  "moderator:manage:chat_settings",
  "moderator:manage:shield_mode",
  "moderator:manage:unban_requests",
  "moderator:manage:shoutouts",
  "moderator:manage:warnings",
  "moderator:read:automod_settings",
  "moderator:read:blocked_terms",
  "moderator:read:chat_settings",
  "moderator:read:chatters",
  "moderator:read:followers",
  "moderator:read:moderators",
  "moderator:read:unban_requests",
  "moderator:read:vips",
  "moderator:read:warnings",
  "moderator:read:shield_mode",
  "moderator:read:shoutouts",
  "user:edit",
  "user:manage:blocked_users",
  "user:manage:chat_color",
  "user:manage:whispers",
  "user:read:blocked_users",
  "user:read:broadcast",
  "user:read:email",
  "user:read:follows",
  "user:read:chat",
  "user:write:chat",
  "user:read:subscriptions",
];

const json = async (url: string, init?: RequestInit): Promise<unknown> => {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`OAuth provider returned ${response.status}`);
  return response.json();
};

const object = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("OAuth provider returned an invalid response");
  return value as Record<string, unknown>;
};

const requiredString = (value: unknown, name: string) => {
  if (typeof value !== "string" || value === "") throw new Error(`OAuth response omitted ${name}`);
  return value;
};

const definitions: ReadonlyArray<ProviderDefinition> = [
  {
    id: "twitch",
    displayName: "Twitch",
    authorizeUrl: "https://id.twitch.tv/oauth2/authorize",
    tokenUrl: "https://id.twitch.tv/oauth2/token",
    scopes: twitchScopes,
    authorizeParams: { force_verify: "true" },
    refresh: true,
    user: async (token, clientId) => {
      const body = object(
        await json("https://api.twitch.tv/helix/users", {
          headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId },
        }),
      );
      const user = object((body.data as ReadonlyArray<unknown> | undefined)?.[0]);
      return {
        id: requiredString(user.id, "user id"),
        displayName: requiredString(user.display_name, "display name"),
      };
    },
  },
  {
    id: "discord",
    displayName: "Discord",
    authorizeUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    scopes: ["identify", "email"],
    refresh: true,
    user: async (token) => {
      const user = object(
        await json("https://discord.com/api/v10/users/@me", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      return {
        id: requiredString(user.id, "user id"),
        displayName:
          typeof user.global_name === "string"
            ? user.global_name
            : requiredString(user.username, "username"),
      };
    },
  },
  {
    id: "github",
    displayName: "GitHub",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: [],
    tokenHeaders: () => ({ Accept: "application/json" }),
    refresh: true,
    user: async (token) => {
      const user = object(
        await json("https://api.github.com/user", {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "MacroGraph-Cloud",
          },
        }),
      );
      return { id: String(user.id), displayName: requiredString(user.login, "login") };
    },
  },
  {
    id: "spotify",
    displayName: "Spotify",
    authorizeUrl: "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    scopes: ["user-read-private", "user-read-email"],
    authorizeParams: { show_dialog: "true" },
    tokenHeaders: (id, secret) => ({ Authorization: `Basic ${btoa(`${id}:${secret}`)}` }),
    refresh: true,
    user: async (token) => {
      const user = object(
        await json("https://api.spotify.com/v1/me", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      return {
        id: requiredString(user.id, "user id"),
        displayName:
          typeof user.display_name === "string"
            ? user.display_name
            : requiredString(user.email, "email"),
      };
    },
  },
  {
    id: "google",
    displayName: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/youtube", "email", "profile", "openid"],
    authorizeParams: { access_type: "offline", prompt: "consent" },
    refresh: true,
    user: async (token) => {
      const user = object(
        await json("https://openidconnect.googleapis.com/v1/userinfo", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      return {
        id: requiredString(user.sub, "user id"),
        displayName:
          typeof user.name === "string" ? user.name : requiredString(user.email, "email"),
      };
    },
  },
  {
    id: "patreon",
    displayName: "Patreon",
    authorizeUrl: "https://www.patreon.com/oauth2/authorize",
    tokenUrl: "https://www.patreon.com/api/oauth2/token",
    scopes: ["identity"],
    refresh: true,
    user: async (token) => {
      const body = object(
        await json("https://www.patreon.com/api/oauth2/v2/identity?fields%5Buser%5D=full_name", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      const data = object(body.data);
      const attributes = object(data.attributes);
      return {
        id: requiredString(data.id, "user id"),
        displayName: requiredString(attributes.full_name, "display name"),
      };
    },
  },
  {
    id: "streamlabs",
    displayName: "Streamlabs",
    authorizeUrl: "https://streamlabs.com/api/v2.0/authorize",
    tokenUrl: "https://streamlabs.com/api/v2.0/token",
    scopes: [],
    refresh: false,
    user: async (token) => {
      const body = object(
        await json("https://streamlabs.com/api/v1.0/user", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      );
      const user = object(body.streamlabs ?? body);
      return {
        id: String(user.id),
        displayName:
          typeof user.display_name === "string"
            ? user.display_name
            : requiredString(user.username, "username"),
      };
    },
  },
];

const tokenFrom = (value: unknown, previousRefreshToken?: string): OAuthToken => {
  const body = object(value);
  const refreshToken =
    typeof body.refresh_token === "string" ? body.refresh_token : previousRefreshToken;
  return {
    access_token: requiredString(body.access_token, "access token"),
    expires_in: typeof body.expires_in === "number" ? body.expires_in : 315_360_000,
    ...(refreshToken === undefined ? {} : { refresh_token: refreshToken }),
    token_type: typeof body.token_type === "string" ? body.token_type : "Bearer",
    ...(typeof body.scope === "string" ? { scope: body.scope } : {}),
  };
};

const requestToken = (provider: Provider, values: Readonly<Record<string, string>>) =>
  Effect.tryPromise({
    try: async () =>
      tokenFrom(
        await json(provider.tokenUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            ...provider.tokenHeaders?.(provider.clientId, Redacted.value(provider.clientSecret)),
          },
          body: new URLSearchParams(values),
        }),
        values.refresh_token,
      ),
    catch: (error) =>
      new ProviderError({
        message: error instanceof Error ? error.message : "OAuth token request failed",
      }),
  });

const make = Effect.gen(function* () {
  const configured = yield* Effect.forEach(definitions, (definition) =>
    Config.all({
      clientId: Config.option(Config.string(`${definition.id.toUpperCase()}_CLIENT_ID`)),
      clientSecret: Config.option(Config.redacted(`${definition.id.toUpperCase()}_CLIENT_SECRET`)),
    }).pipe(
      Effect.map(({ clientId, clientSecret }) =>
        Option.all({ clientId, clientSecret }).pipe(
          Option.map((credentials) => ({ ...definition, ...credentials })),
        ),
      ),
    ),
  );
  const providers = configured.flatMap(Option.toArray);
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  return {
    list: providers.map(({ id, displayName }) => ({ id, displayName })),
    get: (id: string) => byId.get(id),
    authorizeUrl: (provider: Provider, redirectUri: string, state: string) => {
      const params = new URLSearchParams({
        ...provider.authorizeParams,
        client_id: provider.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: provider.scopes.join(" "),
        state,
      });
      return `${provider.authorizeUrl}?${params}`;
    },
    exchange: (provider: Provider, code: string, redirectUri: string) =>
      requestToken(provider, {
        client_id: provider.clientId,
        client_secret: Redacted.value(provider.clientSecret),
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    refresh: (provider: Provider, refreshToken: string) =>
      provider.refresh
        ? requestToken(provider, {
            client_id: provider.clientId,
            client_secret: Redacted.value(provider.clientSecret),
            grant_type: "refresh_token",
            refresh_token: refreshToken,
          })
        : Effect.succeed(undefined),
    user: (provider: Provider, accessToken: string) =>
      Effect.tryPromise({
        try: () => provider.user(accessToken, provider.clientId),
        catch: (error) =>
          new ProviderError({
            message: error instanceof Error ? error.message : "OAuth user request failed",
          }),
      }),
  };
});

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "macrograph/cloudflare/OAuthProviders",
) {}

export const layer = Layer.effect(Service)(make);
