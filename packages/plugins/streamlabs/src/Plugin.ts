import { DataType, Plugin } from "@macrograph/plugin";
import { Effect } from "effect";

import { StreamlabsEngine } from "./Definition.ts";

export default Plugin.make({
  id: "streamlabs",
  name: "Streamlabs",
  engine: StreamlabsEngine,
  effect: Effect.fnUntraced(function* (ctx) {
    yield* ctx.schema.register({
      id: "StreamlabsDonation",
      name: "Streamlabs Donation",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "donation"),
      io: (io) => ({
        name: io.data.out("name", DataType.String),
        amount: io.data.out("amount", DataType.Float),
        formattedAmount: io.data.out("formattedAmount", DataType.String),
        message: io.data.out("message", DataType.String),
        currency: io.data.out("currency", DataType.String),
        from: io.data.out("from", DataType.String),
        fromId: io.data.out("fromId", DataType.String),
        payloadJson: io.data.out("payloadJson", DataType.String, { name: "Payload JSON" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.name(event.name);
          io.amount(event.amount);
          io.formattedAmount(event.formattedAmount);
          io.message(event.message);
          io.currency(event.currency);
          io.from(event.from);
          io.fromId(event.fromId);
          io.payloadJson(event.payloadJson);
        }),
    });
    yield* ctx.schema.register({
      id: "StreamlabsYoutubeMembership",
      name: "YouTube Membership",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "subscription"),
      io: (io) => ({
        name: io.data.out("name", DataType.String),
        months: io.data.out("months", DataType.Float),
        message: io.data.out("message", DataType.String),
        membershipLevelName: io.data.out("membershipLevelName", DataType.String),
        payloadJson: io.data.out("payloadJson", DataType.String, { name: "Payload JSON" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.name(event.name);
          io.months(event.months);
          io.message(event.message);
          io.membershipLevelName(event.membershipLevelName);
          io.payloadJson(event.payloadJson);
        }),
    });
    yield* ctx.schema.register({
      id: "StreamlabsYoutubeSuperchat",
      name: "YouTube Superchat",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "superchat"),
      io: (io) => ({
        name: io.data.out("name", DataType.String),
        currency: io.data.out("currency", DataType.String),
        displayString: io.data.out("displayString", DataType.String),
        amount: io.data.out("amount", DataType.String),
        comment: io.data.out("comment", DataType.String),
        payloadJson: io.data.out("payloadJson", DataType.String, { name: "Payload JSON" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.name(event.name);
          io.currency(event.currency);
          io.displayString(event.displayString);
          io.amount(event.amountText);
          io.comment(event.comment);
          io.payloadJson(event.payloadJson);
        }),
    });
    yield* ctx.schema.register({
      id: "StreamlabsYoutubeMembershipGiftee",
      name: "YouTube Membership Giftee",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "membershipGift"),
      io: (io) => ({
        name: io.data.out("name", DataType.String),
        membershipLevelName: io.data.out("membershipLevelName", DataType.String),
        membershipGiftId: io.data.out("membershipGiftId", DataType.String),
        channelUrl: io.data.out("channelUrl", DataType.String),
        message: io.data.out("message", DataType.String),
        payloadJson: io.data.out("payloadJson", DataType.String, { name: "Payload JSON" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.name(event.name);
          io.membershipLevelName(event.membershipLevelName);
          io.membershipGiftId(event.youtubeMembershipGiftId);
          io.channelUrl(event.channelUrl);
          io.message(event.message);
          io.payloadJson(event.payloadJson);
        }),
    });
    yield* ctx.schema.register({
      id: "StreamlabsYoutubeMembershipGifter",
      name: "YouTube Membership Gifter",
      type: "event",
      event: (event) => Effect.succeed(event.kind === "membershipGiftStart"),
      io: (io) => ({
        name: io.data.out("name", DataType.String),
        giftMembershipsLevelName: io.data.out("giftMembershipsLevelName", DataType.String),
        giftMembershipsCount: io.data.out("giftMembershipsCount", DataType.Int),
        membershipMessageId: io.data.out("membershipMessageId", DataType.String),
        channelUrl: io.data.out("channelUrl", DataType.String),
        payloadJson: io.data.out("payloadJson", DataType.String, { name: "Payload JSON" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (!event) return;
          io.name(event.name);
          io.giftMembershipsLevelName(event.giftMembershipsLevelName);
          io.giftMembershipsCount(event.giftMembershipsCount);
          io.membershipMessageId(event.membershipMessageId);
          io.channelUrl(event.channelUrl);
          io.payloadJson(event.payloadJson);
        }),
    });
  }),
});
