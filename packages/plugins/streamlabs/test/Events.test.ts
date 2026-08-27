import { assert, describe, it } from "vitest";

import { decodeEvent } from "../src/Events.ts";

describe("Streamlabs legacy payload decoding", () => {
  it("decodes donations, memberships, superchat, gifters and giftees", () => {
    const donation = decodeEvent({
      type: "donation",
      message: [{ name: "Donor", amount: "12.50", currency: "USD", fromId: "1" }],
    })!;
    assert.strictEqual(donation.kind, "donation");
    assert.strictEqual(donation.amount, 12.5);
    assert.strictEqual(donation.fromId, "1");
    const membership = decodeEvent({
      type: "subscription",
      for: "youtube_account",
      message: [{ name: "Member", months: "3", membershipLevelName: "Gold" }],
    })!;
    assert.strictEqual(membership.kind, "subscription");
    assert.strictEqual(membership.months, 3);
    assert.strictEqual(membership.membershipLevelName, "Gold");
    const superchat = decodeEvent({
      type: "superchat",
      for: "youtube_account",
      message: [{ name: "Viewer", amount: "1000000", displayString: "$1.00", comment: "Hello" }],
    })!;
    assert.strictEqual(superchat.kind, "superchat");
    assert.strictEqual(superchat.amountText, "1000000");
    assert.strictEqual(superchat.comment, "Hello");
    const gifter = decodeEvent({
      type: "membershipGift",
      for: "youtube_account",
      message: [
        {
          name: "Gifter",
          giftMembershipsCount: "5",
          giftMembershipsLevelName: "Gold",
          membershipMessageId: "gift",
        },
      ],
    })!;
    assert.strictEqual(gifter.kind, "membershipGiftStart");
    assert.strictEqual(gifter.giftMembershipsCount, 5);
    const giftee = decodeEvent({
      type: "membershipGift",
      for: "youtube_account",
      message: [
        {
          name: "Giftee",
          membershipLevelName: "Gold",
          youtubeMembershipGiftId: "gift",
          channelUrl: "https://youtube.com/@test",
        },
      ],
    })!;
    assert.strictEqual(giftee.kind, "membershipGift");
    assert.strictEqual(giftee.youtubeMembershipGiftId, "gift");
    assert.deepStrictEqual(JSON.parse(donation.payloadJson), {
      name: "Donor",
      amount: "12.50",
      currency: "USD",
      fromId: "1",
    });
  });

  it("defaults optional null fields and distinguishes a null count from a giftee", () => {
    const donation = decodeEvent({
      type: "donation",
      message: [{ name: null, amount: null, message: null }],
    })!;
    assert.strictEqual(donation.name, "");
    assert.strictEqual(donation.amount, 0);
    assert.strictEqual(donation.message, "");
    const gift = decodeEvent({
      type: "membershipGift",
      for: "youtube_account",
      message: [{ giftMembershipsCount: null }],
    })!;
    assert.strictEqual(gift.kind, "membershipGiftStart");
    assert.strictEqual(gift.giftMembershipsCount, 0);
  });

  it("accepts finite numeric membership months as well as legacy strings", () => {
    for (const months of [3, "3"]) {
      const membership = decodeEvent({
        type: "subscription",
        for: "youtube_account",
        message: [{ months }],
      });
      assert.strictEqual(membership?.months, 3);
    }
    for (const months of [NaN, Infinity, -Infinity, "Infinity", true]) {
      assert.isUndefined(
        decodeEvent({ type: "subscription", for: "youtube_account", message: [{ months }] }),
      );
    }
  });

  it("uses the first message in a batch without validating or emitting subsequent entries", () => {
    const donation = decodeEvent({
      type: "donation",
      message: [{ name: "First", amount: "2.5" }, { name: "Second", amount: "9" }, null],
    });
    assert.strictEqual(donation?.name, "First");
    assert.strictEqual(donation?.amount, 2.5);
    assert.deepStrictEqual(JSON.parse(donation!.payloadJson), { name: "First", amount: "2.5" });
    assert.isUndefined(
      decodeEvent({ type: "donation", message: [null, { name: "Second", amount: "9" }] }),
    );
  });

  it("filters unsupported sources, empty messages, bad scalar types and non-finite numeric values", () => {
    for (const payload of [
      null,
      {},
      { type: "follow", message: [{}] },
      { type: "subscription", for: "twitch_account", message: [{}] },
      { type: "superchat", message: [{}] },
      { type: "membershipGift", for: "twitch_account", message: [{}] },
      { type: "donation", message: [] },
      { type: "donation", message: {} },
      { type: "donation", message: [{ name: 3 }] },
      { type: "donation", message: [{ amount: 3 }] },
      { type: "donation", message: [{ amount: "not a number" }] },
      { type: "donation", message: [{ amount: "Infinity" }] },
      { type: "subscription", for: "youtube_account", message: [{ months: "NaN" }] },
      {
        type: "membershipGift",
        for: "youtube_account",
        message: [{ giftMembershipsCount: "1.5" }],
      },
      { type: "membershipGift", for: "youtube_account", message: [{ giftMembershipsCount: "-1" }] },
    ])
      assert.isUndefined(decodeEvent(payload));
  });
});
