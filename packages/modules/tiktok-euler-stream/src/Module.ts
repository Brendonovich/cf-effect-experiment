import { t, Module } from "@macrograph/module";
import { Effect } from "effect";

import { TikTokEngine } from "./Definition.ts";

// kind, schema suffix, label, string outputs, integer outputs, boolean outputs
export const catalog = [
  ["chat", "Chat", "Chat", ["comment"], [], []],
  [
    "gift",
    "Gift",
    "Gift",
    ["giftId", "giftName"],
    ["diamonds", "repeatCount", "giftType"],
    ["repeatEnd"],
  ],
  [
    "giftStreak",
    "GiftStreak",
    "Gift Streak Update",
    ["giftId", "giftName"],
    ["diamonds", "repeatCount", "giftType"],
    ["repeatEnd"],
  ],
  ["member", "Member", "Member Join", [], ["memberCount"], []],
  ["follow", "Follow", "Follow", [], [], []],
  ["share", "Share", "Share", [], [], []],
  ["like", "Like", "Like", [], ["likeCount", "totalLikeCount"], []],
  ["roomUser", "RoomUser", "Viewer Count", [], ["viewerCount"], []],
  ["questionNew", "Question", "Question", ["question", "questionId"], [], []],
  ["emote", "Emote", "Emote", ["emoteIdsJson"], [], []],
  ["envelope", "Envelope", "Treasure Chest", ["envelopeId"], ["diamonds", "peopleCount"], []],
  ["liveIntro", "LiveIntro", "Live Intro", ["description"], [], []],
  ["linkMicBattle", "Battle", "Battle", ["battleId"], ["action"], []],
  [
    "linkMicArmies",
    "BattlePoints",
    "Battle Points",
    ["battleId", "giftId"],
    ["giftCount", "totalDiamondCount", "repeatCount"],
    [],
  ],
  ["superFan", "SuperFan", "Super Fan", ["message"], [], []],
  ["superFanJoin", "SuperFanJoin", "Super Fan Join", ["message"], [], []],
  ["streamEnd", "StreamEnd", "Stream End", [], ["action"], []],
  [
    "goalUpdate",
    "GoalUpdate",
    "Goal Update",
    ["description", "contributor"],
    ["contributeCount", "contributeScore"],
    [],
  ],
  ["roomMessage", "RoomMessage", "Room Message", ["message"], [], []],
] as const;

export default Module.make({
  id: "tiktok-euler-stream",
  name: "TikTok (Euler Stream)",
  engine: TikTokEngine,
  effect: Effect.fnUntraced(function* (ctx) {
    for (const [kind, suffix, name, strings, numbers, booleans] of catalog) {
      yield* ctx.schema.register({
        id: `TikTok${suffix}`,
        name: `TikTok ${name}`,
        type: "event",
        event: (event) => Effect.succeed(event.kind === kind),
        io: (io) => ({
          user: io.data.out("user", t.String, { name: "User" }),
          userId: io.data.out("userId", t.String, { name: "User ID" }),
          nickname: io.data.out("nickname", t.String, { name: "Nickname" }),
          payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
          strings: strings.map((field) => ({ field, output: io.data.out(field, t.String) })),
          numbers: numbers.map((field) => ({ field, output: io.data.out(field, t.Int) })),
          booleans: booleans.map((field) => ({ field, output: io.data.out(field, t.Bool) })),
        }),
        run: ({ event, io }) =>
          Effect.sync(() => {
            if (!event) return;
            io.user(event.user);
            io.userId(event.userId);
            io.nickname(event.nickname);
            io.payloadJson(event.payloadJson);
            for (const { field, output } of io.strings) output(event[field]);
            for (const { field, output } of io.numbers) output(event[field]);
            for (const { field, output } of io.booleans) output(event[field]);
          }),
      });
    }
  }),
});
