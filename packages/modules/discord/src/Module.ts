import { t, Module } from "@macrograph/module";
import { Effect } from "effect";

import { DiscordEngine } from "./Definition.ts";

export default Module.make({
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
        message: io.data.out("message", t.String, { name: "Message" }),
        messageID: io.data.out("messageID", t.String, { name: "Message ID" }),
        channelId: io.data.out("channelId", t.String, { name: "Channel ID" }),
        username: io.data.out("username", t.String, { name: "Username" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        guildId: io.data.out("guildId", t.String, { name: "Guild ID" }),
        rolesJson: io.data.out("rolesJson", t.String, { name: "Roles" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
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
        channelId: io.data.in("channelId", t.String, { name: "Channel ID" }),
        message: io.data.in("message", t.String, { name: "Message" }),
        everyone: io.data.in("everyone", t.Bool, {
          name: "Allow @everyone",
          defaultValue: false,
        }),
        messageId: io.data.out("messageId", t.String),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
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
        userId: io.data.in("userId", t.String, { name: "User ID" }),
        username: io.data.out("username", t.String, { name: "UserName" }),
        displayName: io.data.out("displayName", t.String),
        avatarId: io.data.out("avatarId", t.String, { name: "Avatar ID" }),
        bannerId: io.data.out("bannerId", t.String, { name: "Banner ID" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
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
        guildId: io.data.in("guildId", t.String, { name: "Guild ID" }),
        userId: io.data.in("userId", t.String, { name: "User ID" }),
        username: io.data.out("username", t.String, { name: "UserName" }),
        displayName: io.data.out("displayName", t.String, { name: "Display Name" }),
        avatarId: io.data.out("avatarId", t.String, { name: "Avatar ID" }),
        bannerId: io.data.out("bannerId", t.String, { name: "Banner ID" }),
        nick: io.data.out("nick", t.String, { name: "Nickname" }),
        rolesJson: io.data.out("rolesJson", t.String, { name: "Roles" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
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
        guildId: io.data.in("guildId", t.String, { name: "Guild ID" }),
        roleIdIn: io.data.in("roleIdIn", t.String, { name: "Role ID" }),
        roleIdOut: io.data.out("roleIdOut", t.String, { name: "Role ID" }),
        name: io.data.out("name", t.String, { name: "Name" }),
        position: io.data.out("position", t.Int, { name: "Position" }),
        mentionable: io.data.out("mentionable", t.Bool, { name: "Mentionable" }),
        permissions: io.data.out("permissions", t.String, { name: "Permissions" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
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
        webhookUrl: io.data.in("webhookUrl", t.String, { name: "Webhook URL" }),
        content: io.data.in("content", t.String, { name: "Message" }),
        username: io.data.in("username", t.String, { name: "Username", defaultValue: "" }),
        avatarUrl: io.data.in("avatarUrl", t.String, {
          name: "Avatar URL",
          defaultValue: "",
        }),
        tts: io.data.in("tts", t.Bool, { name: "TTS", defaultValue: false }),
        status: io.data.out("status", t.Int, { name: "Status" }),
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
