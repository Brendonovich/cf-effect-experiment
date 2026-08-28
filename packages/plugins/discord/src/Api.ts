import { Context, Effect, Layer, Schema } from "effect";

import { DiscordFailure } from "./Definition.ts";

export const API_ORIGIN = "https://discord.com/api/v10";

export class Http extends Context.Service<
  Http,
  {
    readonly request: (url: string, init: RequestInit) => Effect.Effect<Response, DiscordFailure>;
  }
>()("@macrograph/plugin-discord/Http") {}

export const httpLayer = Layer.succeed(Http, {
  request: (url, init) =>
    Effect.tryPromise({
      try: (signal) =>
        fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) }),
      catch: () => new DiscordFailure({ reason: "network" }),
    }),
});

export const validateToken = (token: string) => /^[A-Za-z0-9._-]{1,4096}$/.test(token);
export const validateId = (id: string) =>
  /^\d{1,20}$/.test(id) ? Effect.void : Effect.fail(new DiscordFailure({ reason: "invalid-id" }));
export const validateMessage = (message: string) =>
  message.trim().length > 0 && message.length <= 2000
    ? Effect.void
    : Effect.fail(new DiscordFailure({ reason: "invalid-message" }));

// Canonicalize onto the fixed API origin; never forward credentials through redirects.
export const webhookUrl = Effect.fnUntraced(function* (input: string) {
  const url = yield* Effect.try({
    try: () => new URL(input),
    catch: () => new DiscordFailure({ reason: "invalid-webhook" }),
  });
  const match = /^\/api\/(?:v10\/)?webhooks\/(\d{1,20})\/([A-Za-z0-9_-]{1,256})$/.exec(
    url.pathname,
  );
  if (
    url.protocol !== "https:" ||
    !["discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com"].includes(
      url.hostname,
    ) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !match
  )
    return yield* new DiscordFailure({ reason: "invalid-webhook" });
  return `${API_ORIGIN}/webhooks/${match[1]}/${match[2]}`;
});

export const checkStatus = (response: Response) => {
  if (response.ok) return Effect.succeed(response);
  const reason =
    response.status === 401
      ? "unauthorized"
      : response.status === 403
        ? "forbidden"
        : response.status === 404
          ? "not-found"
          : response.status === 429
            ? "rate-limited"
            : "http";
  return Effect.fail(new DiscordFailure({ reason }));
};

export const json = (response: Response) =>
  Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: () => new DiscordFailure({ reason: "invalid-response" }),
  });

export const User = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  global_name: Schema.optional(Schema.NullOr(Schema.String)),
  avatar: Schema.optional(Schema.NullOr(Schema.String)),
  banner: Schema.optional(Schema.NullOr(Schema.String)),
});
export const Member = Schema.Struct({
  user: Schema.optional(User),
  nick: Schema.optional(Schema.NullOr(Schema.String)),
  roles: Schema.Array(Schema.String),
});
export const Role = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  position: Schema.Int,
  mentionable: Schema.Boolean,
  permissions: Schema.String,
});
