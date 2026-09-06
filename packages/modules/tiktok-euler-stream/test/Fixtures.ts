import type { TransportEvent } from "../src/Definition.ts";

export const samples: ReadonlyArray<readonly [TransportEvent, unknown]> = [
  [
    "chat",
    {
      user: { displayId: "chatter", id: "9007199254740993", nickname: "Chatter" },
      content: "hello",
    },
  ],
  [
    "gift",
    {
      user: { displayId: "gifter" },
      giftId: "42",
      gift: { type: 1, name: "Rose", diamondCount: 2 },
      repeatCount: 3,
      repeatEnd: 1,
    },
  ],
  [
    "gift",
    {
      user: { displayId: "gifter" },
      giftId: "42",
      gift: { type: 1, name: "Rose", diamondCount: 2 },
      repeatCount: 2,
      repeatEnd: 0,
    },
  ],
  ["member", { user: { displayId: "viewer" }, memberCount: 12 }],
  ["follow", { user: { displayId: "follower" }, action: "1" }],
  ["share", { user: { displayId: "sharer" }, action: "3" }],
  ["like", { user: { displayId: "liker" }, count: 4, total: "1000" }],
  ["roomUser", { total: "25", ranks: [{ user: { displayId: "top" }, score: "5" }] }],
  ["questionNew", { data: { user: { displayId: "asker" }, content: "Why?", questionId: "8" } }],
  ["emote", { user: { displayId: "fan" }, emoteList: [{ emoteId: "100" }, { emoteId: "101" }] }],
  [
    "envelope",
    {
      envelopeInfo: {
        envelopeId: "box",
        sendUserName: "sender",
        sendUserId: "3",
        diamondCount: 50,
        peopleCount: 5,
      },
    },
  ],
  ["liveIntro", { user: { displayId: "host" }, content: "Welcome" }],
  [
    "linkMicBattle",
    { battleId: "battle", action: 1, anchorsInfo: [{ user: { displayId: "host" } }] },
  ],
  [
    "linkMicArmies",
    {
      battleId: "battle",
      giftId: "42",
      giftCount: 2,
      totalDiamondCount: 6,
      repeatCount: 2,
      armies: { host: { points: 6 } },
    },
  ],
  ["superFan", { user: { displayId: "fan" }, content: { defaultPattern: "New Super Fan" } }],
  [
    "superFanJoin",
    { user: { displayId: "fan" }, commonBarrageContent: { defaultPattern: "Super Fan joined" } },
  ],
  ["streamEnd", { action: 3 }],
  [
    "goalUpdate",
    {
      goal: { description: "Gift goal" },
      contributorDisplayId: "giver",
      contributeCount: "4",
      contributeScore: "8",
    },
  ],
  ["roomMessage", { content: "Room announcement", source: 1, scene: "2" }],
];
