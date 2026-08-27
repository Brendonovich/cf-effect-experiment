import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect } from "effect";

import deployment from "../src/Deployment.ts";
import { decodeEvent } from "../src/Events.ts";
import plugin from "../src/Plugin.ts";

describe("Streamlabs plugin", () => {
  it.effect("registers five event schemas and matches only their event kinds", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(plugin.effect);
      assert.deepStrictEqual(
        schemas.map((schema) => schema.id),
        [
          "StreamlabsDonation",
          "StreamlabsYoutubeMembership",
          "StreamlabsYoutubeSuperchat",
          "StreamlabsYoutubeMembershipGiftee",
          "StreamlabsYoutubeMembershipGifter",
        ],
      );
      const events = [
        decodeEvent({ type: "donation", message: [{ amount: "2.5" }] })!,
        decodeEvent({ type: "subscription", for: "youtube_account", message: [{ months: "3" }] })!,
        decodeEvent({
          type: "superchat",
          for: "youtube_account",
          message: [{ amount: "1000000" }],
        })!,
        decodeEvent({
          type: "membershipGift",
          for: "youtube_account",
          message: [{ youtubeMembershipGiftId: "gift" }],
        })!,
        decodeEvent({
          type: "membershipGift",
          for: "youtube_account",
          message: [{ giftMembershipsCount: "5" }],
        })!,
      ];
      const outputs: Array<Record<string, unknown>> = [];
      for (let index = 0; index < schemas.length; index++) {
        const schema = schemas[index]!;
        assert.strictEqual(schema.type, "event");
        for (let other = 0; other < events.length; other++)
          assert.strictEqual(yield* schema.matches(events[other]!, {}), index === other);
        const output: Record<string, unknown> = {};
        yield* schema.run({
          input: () => undefined,
          output: (ref, value) => {
            output[ref.id] = value;
          },
          properties: {},
          event: events[index],
          engine: {},
          execution: {
            projectId: "project",
            graphId: "graph",
            eventNodeId: "node",
            traceId: "trace",
          },
          node: {
            nodeId: "node",
            kind: "event",
            executionPath: "0",
            traceId: "trace",
            withSpan: (_, effect) => effect,
          },
        });
        outputs.push(output);
        assert.isString(output.payloadJson);
      }
      assert.strictEqual(outputs[0]!.amount, 2.5);
      assert.strictEqual(outputs[1]!.months, 3);
      assert.strictEqual(outputs[2]!.amount, "1000000");
      assert.strictEqual(outputs[3]!.membershipGiftId, "gift");
      assert.strictEqual(outputs[4]!.giftMembershipsCount, 5);
      assert.strictEqual(deployment.pluginId, "streamlabs");
      assert.strictEqual(deployment.definition, plugin.engine);
    }),
  );
});
