import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/module";
import { Effect } from "effect";

import { AccountId, SendblueAccount } from "../src/Definition.ts";
import SendblueModule from "../src/Module.ts";

describe("Sendblue module", () => {
  it.effect("selects an account for actions and filters received messages by account", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(SendblueModule.effect);
      const send = schemas.find((schema) => schema.id === "SendMessage")!;
      const receive = schemas.find((schema) => schema.id === "MessageReceived")!;
      for (const schema of [send, receive]) {
        assert.deepStrictEqual(
          schema.properties.map((property) => ({
            id: property.id,
            resource: "resource" in property ? property.resource : undefined,
          })),
          [{ id: "account", resource: SendblueAccount.key }],
        );
      }
      const primary = AccountId.make("primary");
      const other = AccountId.make("other");
      const event = {
        _tag: "SendblueMessageReceived" as const,
        accountId: primary,
        messageHandle: "message-1",
        fromNumber: "+15125550101",
        toNumber: "+15125550100",
        content: "Hello",
        mediaUrl: "",
        service: "iMessage",
        messageType: "message",
        groupId: "",
        dateSent: "2026-10-14T00:00:00Z",
      };
      assert.isTrue(yield* receive.matches(event, { account: primary }));
      assert.isFalse(yield* receive.matches(event, { account: other }));
    }),
  );
});
