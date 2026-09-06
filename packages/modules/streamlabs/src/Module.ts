import { DataType, Module } from "@macrograph/module";
import { Effect } from "effect";

import { StreamlabsEngine } from "./Definition.ts";

export default Module.make({
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
        name: io.data.out("name", DataType.String, { name: "Name" }),
        amount: io.data.out("amount", DataType.Float, { name: "Amount" }),
        formattedAmount: io.data.out("formattedAmount", DataType.String, { name: "Formatted Amount" }),
        message: io.data.out("message", DataType.String, { name: "Message" }),
        currency: io.data.out("currency", DataType.String, { name: "Currency" }),
        from: io.data.out("from", DataType.String, { name: "From" }),
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
        name: io.data.out("name", DataType.String, { name: "Name" }),
        months: io.data.out("months", DataType.Float, { name: "Months" }),
        message: io.data.out("message", DataType.String, { name: "Message" }),
        membershipLevelName: io.data.out("membershipLevelName", DataType.String, { name: "Membership Level Name" }),
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
        name: io.data.out("name", DataType.String, { name: "Name" }),
        currency: io.data.out("currency", DataType.String, { name: "Currency" }),
        displayString: io.data.out("displayString", DataType.String, { name: "Display String" }),
        amount: io.data.out("amount", DataType.String, { name: "Amount" }),
        comment: io.data.out("comment", DataType.String, { name: "Comment" }),
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
        name: io.data.out("name", DataType.String, { name: "Name" }),
        membershipLevelName: io.data.out("membershipLevelName", DataType.String, { name: "Membership Level Name" }),
        membershipGiftId: io.data.out("membershipGiftId", DataType.String, { name: "Membership Gift ID" }),
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
        name: io.data.out("name", DataType.String, { name: "Name" }),
        giftMembershipsLevelName: io.data.out("giftMembershipsLevelName", DataType.String, { name: "Membership Level Name" }),
        giftMembershipsCount: io.data.out("giftMembershipsCount", DataType.Int, { name: "Membership Count" }),
        membershipMessageId: io.data.out("membershipMessageId", DataType.String, { name: "Membership Gift ID" }),
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
