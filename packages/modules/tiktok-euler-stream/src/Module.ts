import { t, Module } from "@macrograph/module";
import { Effect } from "effect";

import { TikTokEngine } from "./Definition.ts";

export default Module.make({
  id: "tiktok-euler-stream",
  name: "TikTok (Euler Stream)",
  engine: TikTokEngine,
  effect: Effect.fnUntraced(function* (ctx) {
    yield* ctx.schema.register({
      id: "TikTokChat",
      name: "TikTok Chat",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "chat"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        comment: io.data.out("comment", t.String),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.comment(event.comment);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokGift",
      name: "TikTok Gift",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "gift"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        giftId: io.data.out("giftId", t.String),
        giftName: io.data.out("giftName", t.String),
        diamonds: io.data.out("diamonds", t.Int),
        repeatCount: io.data.out("repeatCount", t.Int),
        giftType: io.data.out("giftType", t.Int),
        repeatEnd: io.data.out("repeatEnd", t.Bool),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.giftId(event.giftId);
          io.giftName(event.giftName);
          io.diamonds(event.diamonds);
          io.repeatCount(event.repeatCount);
          io.giftType(event.giftType);
          io.repeatEnd(event.repeatEnd);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokGiftStreak",
      name: "TikTok Gift Streak Update",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "giftStreak"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        giftId: io.data.out("giftId", t.String),
        giftName: io.data.out("giftName", t.String),
        diamonds: io.data.out("diamonds", t.Int),
        repeatCount: io.data.out("repeatCount", t.Int),
        giftType: io.data.out("giftType", t.Int),
        repeatEnd: io.data.out("repeatEnd", t.Bool),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.giftId(event.giftId);
          io.giftName(event.giftName);
          io.diamonds(event.diamonds);
          io.repeatCount(event.repeatCount);
          io.giftType(event.giftType);
          io.repeatEnd(event.repeatEnd);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokMember",
      name: "TikTok Member Join",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "member"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        memberCount: io.data.out("memberCount", t.Int),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.memberCount(event.memberCount);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokFollow",
      name: "TikTok Follow",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "follow"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokShare",
      name: "TikTok Share",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "share"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokLike",
      name: "TikTok Like",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "like"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        likeCount: io.data.out("likeCount", t.Int),
        totalLikeCount: io.data.out("totalLikeCount", t.Int),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.likeCount(event.likeCount);
          io.totalLikeCount(event.totalLikeCount);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokRoomUser",
      name: "TikTok Viewer Count",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "roomUser"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        viewerCount: io.data.out("viewerCount", t.Int),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.viewerCount(event.viewerCount);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokQuestion",
      name: "TikTok Question",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "questionNew"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        question: io.data.out("question", t.String),
        questionId: io.data.out("questionId", t.String),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.question(event.question);
          io.questionId(event.questionId);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokEmote",
      name: "TikTok Emote",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "emote"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        emoteIdsJson: io.data.out("emoteIdsJson", t.String),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.emoteIdsJson(event.emoteIdsJson);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokEnvelope",
      name: "TikTok Treasure Chest",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "envelope"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        envelopeId: io.data.out("envelopeId", t.String),
        diamonds: io.data.out("diamonds", t.Int),
        peopleCount: io.data.out("peopleCount", t.Int),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.envelopeId(event.envelopeId);
          io.diamonds(event.diamonds);
          io.peopleCount(event.peopleCount);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokLiveIntro",
      name: "TikTok Live Intro",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "liveIntro"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        description: io.data.out("description", t.String),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.description(event.description);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokBattle",
      name: "TikTok Battle",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "linkMicBattle"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        battleId: io.data.out("battleId", t.String),
        action: io.data.out("action", t.Int),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.battleId(event.battleId);
          io.action(event.action);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokBattlePoints",
      name: "TikTok Battle Points",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "linkMicArmies"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        battleId: io.data.out("battleId", t.String),
        giftId: io.data.out("giftId", t.String),
        giftCount: io.data.out("giftCount", t.Int),
        totalDiamondCount: io.data.out("totalDiamondCount", t.Int),
        repeatCount: io.data.out("repeatCount", t.Int),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.battleId(event.battleId);
          io.giftId(event.giftId);
          io.giftCount(event.giftCount);
          io.totalDiamondCount(event.totalDiamondCount);
          io.repeatCount(event.repeatCount);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokSuperFan",
      name: "TikTok Super Fan",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "superFan"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        message: io.data.out("message", t.String),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.message(event.message);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokSuperFanJoin",
      name: "TikTok Super Fan Join",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "superFanJoin"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        message: io.data.out("message", t.String),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.message(event.message);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokStreamEnd",
      name: "TikTok Stream End",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "streamEnd"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        action: io.data.out("action", t.Int),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.action(event.action);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokGoalUpdate",
      name: "TikTok Goal Update",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "goalUpdate"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        description: io.data.out("description", t.String),
        contributor: io.data.out("contributor", t.String),
        contributeCount: io.data.out("contributeCount", t.Int),
        contributeScore: io.data.out("contributeScore", t.Int),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.description(event.description);
          io.contributor(event.contributor);
          io.contributeCount(event.contributeCount);
          io.contributeScore(event.contributeScore);
        }),
    });
    yield* ctx.schema.register({
      id: "TikTokRoomMessage",
      name: "TikTok Room Message",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "roomMessage"),
      io: (io) => ({
        user: io.data.out("user", t.String, { name: "User" }),
        userId: io.data.out("userId", t.String, { name: "User ID" }),
        nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
        message: io.data.out("message", t.String),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.user(event.user);
          io.userId(event.userId);
          io.nickname(event.nickname);
          io.payloadJson(event.payloadJson);
          io.message(event.message);
        }),
    });
  }),
});
