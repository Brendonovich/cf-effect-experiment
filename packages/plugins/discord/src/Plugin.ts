import { DataType, Plugin } from "@macrograph/plugin";
import { Effect } from "effect";

import { DiscordEngine } from "./Definition.ts";

export default Plugin.make({
  id: "discord",
  name: "Discord",
  engine: DiscordEngine,
  effect: Effect.fnUntraced(function* (ctx) {
    yield* ctx.schema.register({
      id: "DiscordMessage",
      name: "Discord Message",
      type: "event",
      description:
        "A normal message from the configured bot gateway. Enable MESSAGE_CONTENT in settings and the Discord developer portal to receive guild message text.",
      event: (event) => Effect.succeed(event._tag === "DiscordMessageReceived"),
      io: (io) => ({
        message: io.data.out("message", DataType.String),
        messageID: io.data.out("messageID", DataType.String, { name: "Message ID" }),
        channelId: io.data.out("channelId", DataType.String),
        username: io.data.out("username", DataType.String),
        userId: io.data.out("userId", DataType.String),
        nickname: io.data.out("nickname", DataType.String),
        guildId: io.data.out("guildId", DataType.String),
        rolesJson: io.data.out("rolesJson", DataType.String, { name: "Roles JSON" }),
        payloadJson: io.data.out("payloadJson", DataType.String, { name: "Payload JSON" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.message(event.message);
          io.messageID(event.messageID);
          io.channelId(event.channelId);
          io.username(event.username);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.guildId(event.guildId);
          io.rolesJson(event.rolesJson);
          io.payloadJson(event.payloadJson);
        }),
    });
    yield* ctx.schema.register({
      id: "DiscordSendMessage",
      name: "Send Discord Message",
      io: (io) => ({
        channelId: io.data.in("channelId", DataType.String),
        message: io.data.in("message", DataType.String),
        everyone: io.data.in("everyone", DataType.Bool, {
          name: "Allow @everyone",
          defaultValue: false,
        }),
        messageId: io.data.out("messageId", DataType.String),
        payloadJson: io.data.out("payloadJson", DataType.String, { name: "Payload JSON" }),
      }),
      run: ({ io, engine }) =>
        engine
          .DiscordSendMessage({
            channelId: io.channelId,
            message: io.message,
            everyone: io.everyone,
          })
          .pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                io.messageId(result.messageId);
                io.payloadJson(result.payloadJson);
              }),
            ),
            Effect.asVoid,
          ),
    });
    yield* ctx.schema.register({
      id: "DiscordGetUser",
      name: "Get Discord User",
      io: (io) => ({
        userId: io.data.in("userId", DataType.String),
        username: io.data.out("username", DataType.String),
        displayName: io.data.out("displayName", DataType.String),
        avatarId: io.data.out("avatarId", DataType.String),
        bannerId: io.data.out("bannerId", DataType.String),
        payloadJson: io.data.out("payloadJson", DataType.String, { name: "Payload JSON" }),
      }),
      run: ({ io, engine }) =>
        engine.DiscordGetUser({ userId: io.userId }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              io.username(result.username);
              io.displayName(result.displayName);
              io.avatarId(result.avatarId);
              io.bannerId(result.bannerId);
              io.payloadJson(result.payloadJson);
            }),
          ),
          Effect.asVoid,
        ),
    });
    yield* ctx.schema.register({
      id: "DiscordGetGuildMember",
      name: "Get Discord Guild Member",
      description:
        "Uses the configured bot, not an OAuth user token. Missing optional values are empty strings.",
      io: (io) => ({
        guildId: io.data.in("guildId", DataType.String),
        userId: io.data.in("userId", DataType.String),
        username: io.data.out("username", DataType.String),
        displayName: io.data.out("displayName", DataType.String),
        avatarId: io.data.out("avatarId", DataType.String),
        bannerId: io.data.out("bannerId", DataType.String),
        nick: io.data.out("nick", DataType.String),
        rolesJson: io.data.out("rolesJson", DataType.String, { name: "Roles JSON" }),
        payloadJson: io.data.out("payloadJson", DataType.String, { name: "Payload JSON" }),
      }),
      run: ({ io, engine }) =>
        engine.DiscordGetGuildMember({ guildId: io.guildId, userId: io.userId }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              io.username(result.username);
              io.displayName(result.displayName);
              io.avatarId(result.avatarId);
              io.bannerId(result.bannerId);
              io.nick(result.nick);
              io.rolesJson(result.rolesJson);
              io.payloadJson(result.payloadJson);
            }),
          ),
          Effect.asVoid,
        ),
    });
    yield* ctx.schema.register({
      id: "DiscordGetRole",
      name: "Get Discord Role By ID",
      io: (io) => ({
        guildId: io.data.in("guildId", DataType.String),
        roleIdIn: io.data.in("roleIdIn", DataType.String, { name: "Role ID" }),
        roleIdOut: io.data.out("roleIdOut", DataType.String, { name: "Role ID" }),
        name: io.data.out("name", DataType.String),
        position: io.data.out("position", DataType.Int),
        mentionable: io.data.out("mentionable", DataType.Bool),
        permissions: io.data.out("permissions", DataType.String),
        payloadJson: io.data.out("payloadJson", DataType.String, { name: "Payload JSON" }),
      }),
      run: ({ io, engine }) =>
        engine.DiscordGetRole({ guildId: io.guildId, roleId: io.roleIdIn }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              io.roleIdOut(result.id);
              io.name(result.name);
              io.position(result.position);
              io.mentionable(result.mentionable);
              io.permissions(result.permissions);
              io.payloadJson(result.payloadJson);
            }),
          ),
          Effect.asVoid,
        ),
    });
    yield* ctx.schema.register({
      id: "DiscordSendWebhook",
      name: "Send Discord Webhook",
      description:
        "Sends a text webhook to Discord only. Username and avatar URL may be empty. Local file attachments are not supported.",
      io: (io) => ({
        webhookUrl: io.data.in("webhookUrl", DataType.String),
        content: io.data.in("content", DataType.String),
        username: io.data.in("username", DataType.String, { defaultValue: "" }),
        avatarUrl: io.data.in("avatarUrl", DataType.String, { defaultValue: "" }),
        tts: io.data.in("tts", DataType.Bool, { defaultValue: false }),
        status: io.data.out("status", DataType.Int),
      }),
      run: ({ io, engine }) =>
        engine
          .DiscordSendWebhook({
            webhookUrl: io.webhookUrl,
            content: io.content,
            username: io.username,
            avatarUrl: io.avatarUrl,
            tts: io.tts,
          })
          .pipe(
            Effect.tap((status) => Effect.sync(() => io.status(status))),
            Effect.asVoid,
          ),
    });
  }),
});
