import { t, Module } from "@macrograph/module";
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
        name: io.data.out("name", t.String, { name: "Name" }),
        amount: io.data.out("amount", t.Float, { name: "Amount" }),
        formattedAmount: io.data.out("formattedAmount", t.String, {
          name: "Formatted Amount",
        }),
        message: io.data.out("message", t.String, { name: "Message" }),
        currency: io.data.out("currency", t.String, { name: "Currency" }),
        from: io.data.out("from", t.String, { name: "From" }),
        fromId: io.data.out("fromId", t.String),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
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
        name: io.data.out("name", t.String, { name: "Name" }),
        months: io.data.out("months", t.Float, { name: "Months" }),
        message: io.data.out("message", t.String, { name: "Message" }),
        membershipLevelName: io.data.out("membershipLevelName", t.String, {
          name: "Membership Level Name",
        }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
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
        name: io.data.out("name", t.String, { name: "Name" }),
        currency: io.data.out("currency", t.String, { name: "Currency" }),
        displayString: io.data.out("displayString", t.String, { name: "Display String" }),
        amount: io.data.out("amount", t.String, { name: "Amount" }),
        comment: io.data.out("comment", t.String, { name: "Comment" }),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
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
        name: io.data.out("name", t.String, { name: "Name" }),
        membershipLevelName: io.data.out("membershipLevelName", t.String, {
          name: "Membership Level Name",
        }),
        membershipGiftId: io.data.out("membershipGiftId", t.String, {
          name: "Membership Gift ID",
        }),
        channelUrl: io.data.out("channelUrl", t.String),
        message: io.data.out("message", t.String),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
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
        name: io.data.out("name", t.String, { name: "Name" }),
        giftMembershipsLevelName: io.data.out("giftMembershipsLevelName", t.String, {
          name: "Membership Level Name",
        }),
        giftMembershipsCount: io.data.out("giftMembershipsCount", t.Int, {
          name: "Membership Count",
        }),
        membershipMessageId: io.data.out("membershipMessageId", t.String, {
          name: "Membership Gift ID",
        }),
        channelUrl: io.data.out("channelUrl", t.String),
        payloadJson: io.data.out("payloadJson", t.String, { name: "Payload JSON" }),
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
