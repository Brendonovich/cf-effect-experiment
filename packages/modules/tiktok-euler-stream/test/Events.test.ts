import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  User,
  LiveStreamGoal,
  WebcastMemberMessage,
  WebcastGoalUpdateMessage,
  WebcastLinkMicArmies,
} from "tiktok-live-connector";

import { TikTokEvent } from "../src/Definition.ts";
import { decodeEvent } from "../src/Events.ts";
import { samples } from "./Fixtures.ts";

describe("TikTok payloads", () => {
  it("maps native battle senders without overriding canonical identity", () => {
    const defaults = WebcastLinkMicArmies.decode(new Uint8Array());
    assert.strictEqual(defaults.fromUserId, "0");
    const payload = { ...defaults, fromUserId: "9007199254740993" };
    assert.strictEqual(decodeEvent("linkMicArmies", payload)!.userId, "9007199254740993");
    assert.strictEqual(decodeEvent("linkMicArmies", defaults)!.userId, "");
    const { fromUserId, ...absent } = defaults;
    assert.strictEqual(fromUserId, "0");
    assert.strictEqual(decodeEvent("linkMicArmies", absent)!.userId, "");
    const canonical = { ...payload, userId: "42", user: { userId: "43", id: "44" } };
    assert.strictEqual(decodeEvent("linkMicArmies", canonical)!.userId, "42");
    assert.strictEqual(decodeEvent("linkMicArmies", { ...canonical, userId: "0" })!.userId, "43");
    assert.strictEqual(
      decodeEvent("linkMicArmies", { ...payload, user: { userId: "", id: "44" } })!.userId,
      "44",
    );
    assert.strictEqual(
      decodeEvent("linkMicArmies", { ...payload, userId: 0, user: { userId: "", id: "0" } })!
        .userId,
      "9007199254740993",
    );
    assert.strictEqual(
      decodeEvent("chat", { content: "hi", fromUserId: payload.fromUserId })!.userId,
      "",
    );
    assert.isUndefined(decodeEvent("linkMicArmies", { ...payload, fromUserId: {} }));
  });
  it("skips protobuf zero/empty identity defaults using installed v3 decoder defaults", () => {
    const empty = new Uint8Array();
    const member = {
      ...WebcastMemberMessage.decode(empty),
      user: { ...User.decode(empty), id: "9007199254740993", displayId: "viewer" },
    };
    assert.strictEqual(member.userId, "0");
    assert.strictEqual(decodeEvent("member", member)!.userId, "9007199254740993");
    assert.strictEqual(
      decodeEvent("member", { ...member, uniqueId: "", userId: 0 })!.user,
      "viewer",
    );
    assert.isUndefined(decodeEvent("member", WebcastMemberMessage.decode(empty)));
    const goal = {
      ...WebcastGoalUpdateMessage.decode(empty),
      goal: { ...LiveStreamGoal.decode(empty), description: "Goal" },
      contributorId: "9007199254740995",
    };
    assert.strictEqual(goal.contributorDisplayId, "");
    assert.strictEqual(goal.contributorIdStr, "");
    assert.strictEqual(decodeEvent("goalUpdate", goal)!.contributor, "9007199254740995");
    assert.strictEqual(
      decodeEvent("goalUpdate", { ...goal, contributorIdStr: "42" })!.contributor,
      "42",
    );
    assert.strictEqual(
      decodeEvent("goalUpdate", { ...goal, contributorDisplayId: "giver" })!.contributor,
      "giver",
    );
    assert.strictEqual(decodeEvent("goalUpdate", { ...goal, contributorId: "0" })!.contributor, "");
  });
  it("decodes native connector v3 fields rather than relying on outdated README aliases", () => {
    const events = samples.map(([kind, input]) => decodeEvent(kind, input));
    assert.strictEqual(events.length, 19);
    for (const event of events) assert.isTrue(Schema.is(TikTokEvent)(event));
    assert.strictEqual(events[0]!.user, "chatter");
    assert.strictEqual(events[0]!.userId, "9007199254740993");
    assert.strictEqual(events[0]!.comment, "hello");
    assert.strictEqual(events[1]!.kind, "gift");
    assert.strictEqual(events[1]!.diamonds, 2);
    assert.strictEqual(events[1]!.repeatCount, 3);
    assert.strictEqual(events[1]!.giftName, "Rose");
    assert.strictEqual(events[2]!.kind, "giftStreak");
    assert.strictEqual(events[6]!.likeCount, 4);
    assert.strictEqual(events[6]!.totalLikeCount, 1000);
    assert.strictEqual(events[7]!.viewerCount, 25);
    assert.deepStrictEqual(JSON.parse(events[7]!.payloadJson).ranks, [
      { user: { displayId: "top" }, score: "5" },
    ]);
    assert.strictEqual(events[8]!.user, "asker");
    assert.strictEqual(events[8]!.question, "Why?");
    assert.strictEqual(events[9]!.emoteIdsJson, '["100","101"]');
    assert.strictEqual(events[10]!.user, "sender");
    assert.strictEqual(events[10]!.diamonds, 50);
    assert.strictEqual(events[11]!.description, "Welcome");
    assert.strictEqual(events[13]!.totalDiamondCount, 6);
    assert.strictEqual(events[15]!.message, "Super Fan joined");
    assert.strictEqual(events[17]!.contributeScore, 8);
  });

  it("preserves Electron/Euler outputs and handles numeric and boolean gift streak ends", () => {
    assert.strictEqual(decodeEvent("chat", { uniqueId: "old", comment: "hello" })!.user, "old");
    assert.strictEqual(
      decodeEvent("chat", { user: { uniqueId: "nested" }, comment: "hello" })!.user,
      "nested",
    );
    const layouts = [
      { giftType: 1, extendedGiftInfo: { name: "Rose", diamondCount: 2 } },
      { giftDetails: { giftType: 1, giftName: "Rose", diamondCount: 2 } },
      { giftType: 1, gift: { gift_name: "Rose", diamond_count: 2 } },
    ];
    for (const layout of layouts) {
      for (const repeatEnd of [true, 1, false, 0]) {
        const event = decodeEvent("gift", {
          ...layout,
          uniqueId: "gifter",
          repeatEnd,
          repeatCount: 3,
        })!;
        assert.strictEqual(event.kind, repeatEnd ? "gift" : "giftStreak");
        assert.strictEqual(event.giftName, "Rose");
        assert.strictEqual(event.diamonds, 2);
      }
    }
    assert.strictEqual(
      decodeEvent("gift", { giftId: 4, giftType: 2, repeatEnd: false })!.kind,
      "gift",
    );
    assert.strictEqual(
      decodeEvent("like", { uniqueId: "liker", likeCount: 2, totalLikeCount: 10 })!.likeCount,
      2,
    );
    assert.strictEqual(
      decodeEvent("questionNew", { details: { user: { uniqueId: "asker" }, questionText: "Q?" } })!
        .question,
      "Q?",
    );
    assert.strictEqual(
      decodeEvent("liveIntro", { host: { uniqueId: "host" }, description: "Intro" })!.user,
      "host",
    );
  });

  it("classifies social messages conservatively and does not fabricate follows", () => {
    assert.strictEqual(decodeEvent("social", { uniqueId: "user", action: "3" })!.kind, "share");
    assert.strictEqual(decodeEvent("social", { uniqueId: "user", displayStyle: 2 })!.kind, "share");
    assert.strictEqual(decodeEvent("social", { uniqueId: "user", shareType: "1" })!.kind, "share");
    assert.strictEqual(
      decodeEvent("social", { uniqueId: "user", action: "1", shareType: "0" })!.kind,
      "follow",
    );
    assert.strictEqual(
      decodeEvent("social", {
        uniqueId: "user",
        common: { displayText: { key: "ttlive_follow" } },
      })!.kind,
      "follow",
    );
    assert.isUndefined(decodeEvent("social", { uniqueId: "user", action: "0", shareType: "0" }));
  });

  it("rejects malformed, non-finite, unsafe, oversized and cyclic payloads", () => {
    for (const [kind] of samples)
      for (const invalid of [null, [], "text", {}, { user: 1 }])
        assert.isUndefined(decodeEvent(kind, invalid));
    for (const count of [
      -1,
      1.5,
      Infinity,
      NaN,
      "Infinity",
      "1.5",
      "-1",
      "9007199254740993",
      9007199254740993n,
    ]) {
      assert.isUndefined(decodeEvent("like", { count }));
    }
    assert.isUndefined(decodeEvent("chat", { comment: 1 }));
    assert.isUndefined(decodeEvent("gift", { giftId: "1", repeatEnd: "false" }));
    assert.isUndefined(decodeEvent("gift", { giftId: "1", gift: { diamondCount: "bad" } }));
    assert.isUndefined(decodeEvent("emote", { emoteList: [{}] }));
    assert.isUndefined(decodeEvent("chat", { comment: "x".repeat(1_048_576) }));
    const cyclic: Record<string, unknown> = { comment: "hi" };
    cyclic.self = cyclic;
    assert.isUndefined(decodeEvent("chat", cyclic));
    const bigint = decodeEvent("chat", { userId: 9007199254740993n, comment: "hi" })!;
    assert.strictEqual(bigint.userId, "9007199254740993");
    assert.strictEqual(JSON.parse(bigint.payloadJson).userId, "9007199254740993");
  });
});
