import { Effect, Layer, Queue, Schema, Semaphore, Stream } from "effect";

import {
  API_ORIGIN,
  Http,
  Member,
  Role,
  User,
  checkStatus,
  httpLayer,
  json,
  validateId,
  validateMessage,
  validateToken,
  webhookUrl,
} from "./Api.ts";
import {
  ClientRpcs,
  type ClientState,
  DiscordEngine,
  DiscordFailure,
  RuntimeRpcs,
} from "./Definition.ts";
import { Gateway, gatewayLayer } from "./Gateway.ts";

const decode =
  <A, I>(schema: Schema.Codec<A, I>) =>
  (input: unknown) =>
    Schema.decodeUnknownEffect(schema, { onExcessProperty: "preserve" })(input).pipe(
      Effect.mapError(() => new DiscordFailure({ reason: "invalid-response" })),
    );

export const layer = DiscordEngine.toLayer((mg) =>
  Effect.gen(function* () {
    const http = yield* Http;
    const gateway = yield* Gateway;
    const lock = yield* Semaphore.make(1);
    const callbacks = yield* Queue.dropping<Effect.Effect<void>>(1024);
    yield* Stream.runForEach(Stream.fromQueue(callbacks), (effect) => effect).pipe(
      Effect.forkScoped,
    );
    yield* Effect.addFinalizer(() => Queue.shutdown(callbacks).pipe(Effect.asVoid));
    let config = yield* mg.storage.get;
    let state: typeof ClientState.Type = {
      configured: config.token.length > 0,
      gatewayEnabled: config.gatewayEnabled,
      messageContent: config.messageContent,
      status: "disconnected",
    };
    let close: (() => void) | undefined;
    let generation = 0;
    const stop = () => {
      generation++;
      close?.();
      close = undefined;
    };
    yield* Effect.addFinalizer(() => Effect.sync(stop));

    const start = Effect.fnUntraced(function* () {
      stop();
      state = {
        configured: config.token.length > 0,
        gatewayEnabled: config.gatewayEnabled,
        messageContent: config.messageContent,
        status: "disconnected",
      };
      if (config.gatewayEnabled && config.token) {
        const current = generation;
        yield* Effect.try({
          try: () => {
            close = gateway.start({
              token: config.token,
              messageContent: config.messageContent,
              onMessage: (message) => {
                if (current === generation)
                  Queue.offerUnsafe(
                    callbacks,
                    Effect.suspend(() => (current === generation ? mg.emit(message) : Effect.void)),
                  );
              },
              onStatus: (status, error) => {
                if (current !== generation) return;
                state = {
                  configured: state.configured,
                  gatewayEnabled: state.gatewayEnabled,
                  messageContent: state.messageContent,
                  status,
                  ...(error === undefined ? {} : { error }),
                };
                Queue.offerUnsafe(callbacks, mg.client.refresh);
              },
            });
          },
          catch: () => new DiscordFailure({ reason: "network" }),
        }).pipe(
          Effect.catchCause(() =>
            Effect.sync(() => {
              state = { ...state, status: "error", error: "connection-failed" };
            }),
          ),
        );
      }
      yield* mg.client.refresh;
    });

    const save = Effect.fnUntraced(function* (next: typeof DiscordEngine.Storage.Type) {
      yield* Effect.suspend(() => mg.storage.set(next)).pipe(
        Effect.catchCause(() => Effect.fail(new DiscordFailure({ reason: "storage-failed" }))),
      );
      config = next;
      yield* start();
    });

    const botRequest = Effect.fnUntraced(function* (path: string, method = "GET", body?: unknown) {
      if (!config.token) return yield* new DiscordFailure({ reason: "not-configured" });
      if (!validateToken(config.token))
        return yield* new DiscordFailure({ reason: "invalid-token" });
      const response = yield* http
        .request(`${API_ORIGIN}${path}`, {
          method,
          redirect: "error",
          headers: { Authorization: `Bot ${config.token}`, "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        .pipe(Effect.flatMap(checkStatus));
      return yield* json(response);
    });

    yield* start();
    return DiscordEngine.of({
      resources: Layer.empty,
      rpcs: RuntimeRpcs.toLayer({
        DiscordSendMessage: ({ channelId, message, everyone }) =>
          Effect.gen(function* () {
            yield* validateId(channelId);
            yield* validateMessage(message);
            const payload = yield* botRequest(`/channels/${channelId}/messages`, "POST", {
              content: message,
              allowed_mentions: { parse: everyone ? ["everyone"] : [] },
            });
            const result = yield* decode(Schema.Struct({ id: Schema.String }))(payload);
            return { messageId: result.id, payloadJson: JSON.stringify(payload) };
          }),
        DiscordGetUser: ({ userId }) =>
          Effect.gen(function* () {
            yield* validateId(userId);
            const payload = yield* botRequest(`/users/${userId}`);
            const user = yield* decode(User)(payload);
            return {
              username: user.username,
              displayName: user.global_name ?? "",
              avatarId: user.avatar ?? "",
              bannerId: user.banner ?? "",
              payloadJson: JSON.stringify(payload),
            };
          }),
        DiscordGetGuildMember: ({ guildId, userId }) =>
          Effect.gen(function* () {
            yield* validateId(guildId);
            yield* validateId(userId);
            const payload = yield* botRequest(`/guilds/${guildId}/members/${userId}`);
            const member = yield* decode(Member)(payload);
            return {
              username: member.user?.username ?? "",
              displayName: member.user?.global_name ?? "",
              avatarId: member.user?.avatar ?? "",
              bannerId: member.user?.banner ?? "",
              nick: member.nick ?? "",
              rolesJson: JSON.stringify(member.roles),
              payloadJson: JSON.stringify(payload),
            };
          }),
        DiscordGetRole: ({ guildId, roleId }) =>
          Effect.gen(function* () {
            yield* validateId(guildId);
            yield* validateId(roleId);
            const payload = yield* botRequest(`/guilds/${guildId}/roles`);
            const roles = yield* decode(Schema.Array(Role))(payload);
            const role = roles.find((role) => role.id === roleId);
            if (!role) return yield* new DiscordFailure({ reason: "not-found" });
            return { ...role, payloadJson: JSON.stringify(role) };
          }),
        DiscordSendWebhook: ({ webhookUrl: input, content, username, avatarUrl, tts }) =>
          Effect.gen(function* () {
            const url = yield* webhookUrl(input);
            yield* validateMessage(content);
            if (username.length > 80 || avatarUrl.length > 2048)
              return yield* new DiscordFailure({ reason: "invalid-message" });
            if (avatarUrl) {
              const avatar = yield* Effect.try({
                try: () => new URL(avatarUrl),
                catch: () => new DiscordFailure({ reason: "invalid-message" }),
              });
              if (avatar.protocol !== "https:" || avatar.username || avatar.password)
                return yield* new DiscordFailure({ reason: "invalid-message" });
            }
            const response = yield* http
              .request(url, {
                method: "POST",
                redirect: "error",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  content,
                  tts,
                  allowed_mentions: { parse: [] },
                  ...(username ? { username } : {}),
                  ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
                }),
              })
              .pipe(Effect.flatMap(checkStatus));
            return response.status;
          }),
      }),
      client: {
        state: Effect.sync(() => state),
        rpcs: ClientRpcs.toLayer({
          DiscordConfigure: (input) =>
            Effect.gen(function* () {
              if (!validateToken(input.token))
                return yield* new DiscordFailure({ reason: "invalid-token" });
              yield* save(input);
            }).pipe(lock.withPermit),
          DiscordSetGateway: ({ enabled, messageContent }) =>
            Effect.gen(function* () {
              if (enabled && !config.token)
                return yield* new DiscordFailure({ reason: "not-configured" });
              yield* save({ ...config, gatewayEnabled: enabled, messageContent });
            }).pipe(lock.withPermit),
          DiscordClear: () =>
            save({ token: "", gatewayEnabled: false, messageContent: false }).pipe(lock.withPermit),
        }),
      },
    });
  }),
);

export default layer.pipe(Layer.provide(httpLayer), Layer.provide(gatewayLayer));
