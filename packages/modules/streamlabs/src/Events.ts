import { Option, Schema } from "effect";

import { StreamlabsEvent } from "./Definition.ts";

const Text = Schema.optional(Schema.NullOr(Schema.String));
const Envelope = Schema.Struct({
  type: Schema.String,
  for: Schema.optional(Schema.String),
  message: Schema.NonEmptyArray(Schema.Unknown),
});
const Donation = Schema.Struct({
  name: Text,
  amount: Text,
  currency: Text,
  formattedAmount: Text,
  message: Text,
  from: Text,
  fromId: Text,
});
const Subscription = Schema.Struct({
  name: Text,
  months: Schema.optional(Schema.NullOr(Schema.Union([Schema.String, Schema.Number]))),
  message: Text,
  membershipLevelName: Text,
});
const Superchat = Schema.Struct({
  name: Text,
  currency: Text,
  displayString: Text,
  amount: Text,
  comment: Text,
});
const Gift = Schema.Struct({
  name: Text,
  channelUrl: Text,
  giftMembershipsLevelName: Text,
  giftMembershipsCount: Text,
  membershipMessageId: Text,
  membershipLevelName: Text,
  message: Text,
  youtubeMembershipGiftId: Text,
});

const defaults = {
  name: "",
  amount: 0,
  amountText: "",
  currency: "",
  formattedAmount: "",
  message: "",
  from: "",
  fromId: "",
  months: 0,
  membershipLevelName: "",
  displayString: "",
  comment: "",
  channelUrl: "",
  giftMembershipsLevelName: "",
  giftMembershipsCount: 0,
  membershipMessageId: "",
  youtubeMembershipGiftId: "",
};

/** Like the legacy decoder, uses only the first message and filters non-YouTube subscriptions/gifts. */
export function decodeEvent(input: unknown): StreamlabsEvent | undefined {
  const envelope = Schema.decodeUnknownOption(Envelope)(input);
  if (Option.isNone(envelope)) return;
  const value = envelope.value;
  if (value.type !== "donation" && value.for !== "youtube_account") return;
  const payload = value.message[0];
  switch (value.type) {
    case "donation": {
      const result = Schema.decodeUnknownOption(Donation)(payload);
      if (Option.isNone(result)) return;
      const data = result.value;
      const amount = Number(data.amount ?? 0);
      if (!Number.isFinite(amount)) return;
      return new StreamlabsEvent({
        ...defaults,
        kind: "donation",
        name: data.name ?? "",
        amount,
        currency: data.currency ?? "",
        formattedAmount: data.formattedAmount ?? "",
        message: data.message ?? "",
        from: data.from ?? "",
        fromId: data.fromId ?? "",
        payloadJson: JSON.stringify(data),
      });
    }
    case "subscription": {
      const result = Schema.decodeUnknownOption(Subscription)(payload);
      if (Option.isNone(result)) return;
      const data = result.value;
      const months = Number(data.months ?? 0);
      if (!Number.isFinite(months)) return;
      return new StreamlabsEvent({
        ...defaults,
        kind: "subscription",
        name: data.name ?? "",
        months,
        message: data.message ?? "",
        membershipLevelName: data.membershipLevelName ?? "",
        payloadJson: JSON.stringify(data),
      });
    }
    case "superchat": {
      const result = Schema.decodeUnknownOption(Superchat)(payload);
      if (Option.isNone(result)) return;
      const data = result.value;
      return new StreamlabsEvent({
        ...defaults,
        kind: "superchat",
        name: data.name ?? "",
        currency: data.currency ?? "",
        displayString: data.displayString ?? "",
        amountText: data.amount ?? "",
        comment: data.comment ?? "",
        payloadJson: JSON.stringify(data),
      });
    }
    case "membershipGift": {
      const result = Schema.decodeUnknownOption(Gift)(payload);
      if (Option.isNone(result)) return;
      const data = result.value;
      const count = Number(data.giftMembershipsCount ?? 0);
      if (!Number.isSafeInteger(count) || count < 0) return;
      return new StreamlabsEvent({
        ...defaults,
        kind: Object.hasOwn(data, "giftMembershipsCount")
          ? "membershipGiftStart"
          : "membershipGift",
        name: data.name ?? "",
        channelUrl: data.channelUrl ?? "",
        giftMembershipsLevelName: data.giftMembershipsLevelName ?? "",
        giftMembershipsCount: count,
        membershipMessageId: data.membershipMessageId ?? "",
        membershipLevelName: data.membershipLevelName ?? "",
        message: data.message ?? "",
        youtubeMembershipGiftId: data.youtubeMembershipGiftId ?? "",
        payloadJson: JSON.stringify(data),
      });
    }
  }
}
