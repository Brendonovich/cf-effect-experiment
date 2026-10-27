import { Module, t } from "@macrograph/module";
import { Effect } from "effect";

import { SendblueAccount, SendblueEngine } from "./Definition.ts";

export default Module.make({
  name: "Sendblue",
  engine: SendblueEngine,
  effect: Effect.fnUntraced(function* (context) {
    yield* context.schema.register({
      id: "SendMessage",
      name: "Send Message",
      description: "Sends an iMessage or SMS through Sendblue.",
      properties: { account: { name: "Account", resource: SendblueAccount } },
      io: (io) => ({
        fromNumber: io.data.in("fromNumber", t.String, { name: "From Number" }),
        number: io.data.in("number", t.String, { name: "To Number" }),
        content: io.data.in("content", t.String, { name: "Content", defaultValue: "" }),
        mediaUrl: io.data.in("mediaUrl", t.String, { name: "Media URL", defaultValue: "" }),
        messageHandle: io.data.out("messageHandle", t.String, { name: "Message Handle" }),
        status: io.data.out("status", t.String, { name: "Status" }),
        service: io.data.out("service", t.String, { name: "Service" }),
        wasDowngraded: io.data.out("wasDowngraded", t.Bool, { name: "Was Downgraded" }),
      }),
      run: ({ io, engine, properties }) =>
        engine
          .SendblueSendMessage({
            accountId: properties.account,
            fromNumber: io.fromNumber,
            number: io.number,
            content: io.content,
            mediaUrl: io.mediaUrl,
          })
          .pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                io.messageHandle(result.messageHandle);
                io.status(result.status);
                io.service(result.service);
                io.wasDowngraded(result.wasDowngraded);
              }),
            ),
            Effect.asVoid,
          ),
    });

    yield* context.schema.register({
      id: "MessageReceived",
      name: "Message Received",
      description: "Runs when Sendblue receives an iMessage or SMS.",
      type: "event",
      properties: { account: { name: "Account", resource: SendblueAccount } },
      event: (event, { properties }) =>
        Effect.succeed(
          event._tag === "SendblueMessageReceived" && event.accountId === properties.account,
        ),
      io: (io) => ({
        messageHandle: io.data.out("messageHandle", t.String, { name: "Message Handle" }),
        fromNumber: io.data.out("fromNumber", t.String, { name: "From Number" }),
        toNumber: io.data.out("toNumber", t.String, { name: "To Number" }),
        content: io.data.out("content", t.String, { name: "Content" }),
        mediaUrl: io.data.out("mediaUrl", t.String, { name: "Media URL" }),
        service: io.data.out("service", t.String, { name: "Service" }),
        messageType: io.data.out("messageType", t.String, { name: "Message Type" }),
        groupId: io.data.out("groupId", t.String, { name: "Group ID" }),
        dateSent: io.data.out("dateSent", t.String, { name: "Date Sent" }),
      }),
      run: ({ event, io }) =>
        Effect.sync(() => {
          if (event === undefined) return;
          io.messageHandle(event.messageHandle);
          io.fromNumber(event.fromNumber);
          io.toNumber(event.toNumber);
          io.content(event.content);
          io.mediaUrl(event.mediaUrl);
          io.service(event.service);
          io.messageType(event.messageType);
          io.groupId(event.groupId);
          io.dateSent(event.dateSent);
        }),
    });
  }),
});
