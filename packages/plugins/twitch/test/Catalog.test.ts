import { assert, describe, it } from "@effect/vitest";
import { Registration } from "@macrograph/plugin";
import { Effect, Option } from "effect";

import { actions } from "../src/Actions.ts";
import { actionIds, existingActionIds, count, events, ids } from "../src/Catalog.ts";
import { AccountId, TwitchAccount, TwitchEventSub } from "../src/Definition.ts";
import { SubscriptionEvent } from "../src/EventSub.ts";
import TwitchPlugin from "../src/Plugin.ts";

const expected = [
  ["ChannelChatMessage", "Chat Message", "event"],
  ["ChannelChatClear", "Chat Clear", "event"],
  ["ChannelChatClearUserMessages", "Chat Clear User Messages", "event"],
  ["ChannelChatMessageDelete", "Chat Message Delete", "event"],
  ["ChannelChatNotification", "Chat Notification", "event"],
  ["ChannelChatSettingsUpdate", "Chat Settings Update", "event"],
  ["ChannelChatUserMessageHold", "Chat User Message Hold", "event"],
  ["ChannelChatUserMessageUpdate", "Chat User Message Update", "event"],
  ["ChannelBan", "User Banned", "event"],
  ["ChannelUnban", "User Unbanned", "event"],
  ["ChannelUpdate", "Updated", "event"],
  ["ChannelRaid", "Raid", "event"],
  ["ChannelSubscribe", "Subscribed", "event"],
  ["ChannelSubscriptionEnd", "Subscription Ended", "event"],
  ["ChannelSubscriptionGift", "Subscription Gifted", "event"],
  ["ChannelSubscriptionMessage", "Subscription Message", "event"],
  ["ChannelCheer", "Cheered", "event"],
  ["ChannelModeratorAdd", "Moderator Added", "event"],
  ["ChannelModeratorRemove", "Moderator Removed", "event"],
  ["ChannelVipAdd", "VIP Added", "event"],
  ["ChannelVipRemove", "VIP Removed", "event"],
  ["ChannelModerate", "Moderated", "event"],
  ["ChannelUnbanRequestCreate", "Unban Request Created", "event"],
  ["ChannelUnbanRequestResolve", "Unban Request Resolved", "event"],
  ["ChannelSuspiciousUserUpdate", "Suspicious User Update", "event"],
  ["ChannelSuspiciousUserMessage", "Suspicious User Message", "event"],
  ["ChannelWarningAcknowledge", "Warning Acknowledged", "event"],
  ["ChannelWarningSend", "Warning Sent", "event"],
  ["AutomodSettingsUpdate", "Automod Settings Update", "event"],
  ["AutomodTermsUpdate", "Automod Terms Update", "event"],
  ["ChannelPollBegin", "Poll Began", "event"],
  ["ChannelPollProgress", "Poll Progress", "event"],
  ["ChannelPollEnd", "Poll End", "event"],
  ["ChannelPredictionBegin", "Prediction Began", "event"],
  ["ChannelPredictionProgress", "Prediction Progress", "event"],
  ["ChannelPredictionLock", "Prediction Locked", "event"],
  ["ChannelPredictionEnd", "Prediction End", "event"],
  ["ChannelPointsAutomaticRewardRedemptionAdd", "Points Reward Redeemed", "event"],
  ["HypeTrainBegin", "Hype Train Begin", "event"],
  ["HypeTrainProgress", "Hype Train Progress", "event"],
  ["HypeTrainEnd", "Hype Train End", "event"],
  ["ChannelCharityCampaignDonate", "Charity Donation", "event"],
  ["ChannelCharityCampaignStart", "Charity Campaign Started", "event"],
  ["ChannelCharityCampaignProgress", "Charity Campaign Progress", "event"],
  ["ChannelCharityCampaignStop", "Charity Campaign Stopped", "event"],
  ["ChannelSharedChatSessionBegin", "Shared Chat Session Began", "event"],
  ["ChannelSharedChatSessionUpdate", "Shared Chat Session Update", "event"],
  ["ChannelSharedChatSessionEnd", "Shared Chat Session End", "event"],
  ["ChannelAdBreakBegin", "Ad Break Begin", "event"],
  ["SendChatMessage", "Send Chat Message", "exec"],
  ["GetChatSettings", "Get Chat Settings", "exec"],
  ["UpdateChatSettings", "Update Chat Settings", "exec"],
  ["GetChannelInformation", "Get Channel Information", "exec"],
  ["ModifyChannelInformation", "Modify Channel Information", "exec"],
  ["GetStreams", "Get Streams", "exec"],
  ["CreateClip", "Create Clip", "exec"],
  ["CreatePoll", "Create Poll", "exec"],
  ["EndPoll", "End Poll", "exec"],
  ["CreatePrediction", "Create Prediction", "exec"],
  ["EndPrediction", "End Prediction", "exec"],
  ["GetUsers", "Get Users", "exec"],
  ["GetFollowers", "Get Followers", "exec"],
] as const;

const execution = {
  projectId: "project",
  graphId: "graph",
  eventNodeId: "event",
  traceId: "trace",
};
const node = {
  nodeId: "node",
  kind: "exec" as const,
  executionPath: "node",
  traceId: "trace",
  withSpan: <A, E, R>(_name: string, effect: Effect.Effect<A, E, R>) => effect,
};

describe("Twitch catalog", () => {
  it.effect("matches the exact active reference catalog", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(TwitchPlugin.effect);
      assert.strictEqual(events.length, 49);
      assert.strictEqual(count, 92);
      assert.strictEqual(new Set(ids).size, 92);
      assert.strictEqual(actionIds.length, 43);
      assert.deepStrictEqual(
        schemas.map(({ id, name, type }) => [id, name, type]),
        [
          ...expected.map((item) => [...item]),
          ...actions.map(({ id, name }) => [id, name, "exec"]),
        ],
      );
      assert.isTrue(schemas.every(({ description }) => description !== undefined));
      assert.isTrue(
        schemas.slice(0, 49).every(({ description }) => !description?.includes("Twitch emits")),
      );
      assert.isTrue(
        schemas
          .slice(0, 49)
          .every(
            ({ properties }) =>
              properties[0] !== undefined &&
              "resource" in properties[0] &&
              properties[0].resource === TwitchEventSub.key,
          ),
      );
      assert.isTrue(
        schemas
          .slice(49)
          .every(
            ({ properties }) =>
              properties[0] !== undefined &&
              "resource" in properties[0] &&
              properties[0].resource === TwitchAccount.key,
          ),
      );
    }),
  );

  it.effect("filters by selected account, maps payloads, and tolerates future fields", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(TwitchPlugin.effect);
      const schema = schemas.find(({ id }) => id === "ChannelChatMessage");
      assert.isDefined(schema);
      const decoded = yield* Effect.fromResult(
        SubscriptionEvent.decodeAny({
          _tag: "channel.chat.message",
          broadcaster_user_id: "account-1",
          broadcaster_user_login: "streamer",
          broadcaster_user_name: "Streamer",
          chatter_user_id: "viewer-1",
          chatter_user_login: "viewer",
          chatter_user_name: "Viewer",
          message_id: "message-1",
          message: { text: "hello", future_nested_field: true },
          color: "#fff",
          future_event_field: { value: 1 },
        }),
      );
      assert.isTrue(yield* schema.matches(decoded, { socket: AccountId.make("account-1") }));
      assert.isFalse(yield* schema.matches(decoded, { socket: AccountId.make("account-2") }));
      const outputs = new Map<string, unknown>();
      yield* schema.run({
        input: () => undefined,
        output: (ref, value) => outputs.set(ref.id, value),
        properties: { socket: AccountId.make("account-1") },
        event: decoded,
        engine: {},
        execution,
        node,
      });
      assert.strictEqual(outputs.get("messageText"), "hello");
      assert.strictEqual(outputs.get("chatterUserId"), "viewer-1");
    }),
  );

  it.effect("decodes and executes every active EventSub category", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(TwitchPlugin.effect);
      for (const definition of events) {
        const schema = schemas.find(({ id }) => id === definition.id);
        assert.isDefined(schema);
        const payload: Record<string, unknown> = {
          _tag: definition.tag,
          broadcaster_user_id: "account-1",
          to_broadcaster_user_id: "account-1",
          from_broadcaster_user_id: "account-1",
          future_field: true,
        };
        for (const output of definition.outputs) {
          const parts = output.path.split(".");
          let current = payload;
          for (const part of parts.slice(0, -1)) {
            const existing = current[part];
            const nested =
              typeof existing === "object" && existing !== null
                ? Object.fromEntries(Object.entries(existing))
                : {};
            current[part] = nested;
            current = nested;
          }
          const key = parts.at(-1);
          if (key !== undefined)
            current[key] = output.kind === "bool" ? true : output.kind === "int" ? 1 : "value";
        }
        payload.broadcaster_user_id = "account-1";
        payload.to_broadcaster_user_id = "account-1";
        payload.from_broadcaster_user_id = "account-1";
        const decoded = yield* Effect.fromResult(SubscriptionEvent.decodeAny(payload));
        assert.isTrue(
          yield* schema.matches(decoded, { socket: AccountId.make("account-1") }),
          definition.id,
        );
        yield* schema.run({
          input: () => undefined,
          output: () => undefined,
          properties: { socket: AccountId.make("account-1") },
          event: decoded,
          engine: {},
          execution,
          node,
        });
      }
    }),
  );

  it.effect("rejects malformed EventSub payloads instead of padding outputs", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(TwitchPlugin.effect);
      const schema = schemas.find(({ id }) => id === "ChannelBan");
      assert.isDefined(schema);
      const decoded = yield* Effect.fromResult(
        SubscriptionEvent.decodeAny({
          _tag: "channel.ban",
          broadcaster_user_id: "account-1",
        }),
      );
      assert.isFalse(yield* schema.matches(decoded, { socket: AccountId.make("account-1") }));
    }),
  );

  it.effect("forwards operation-specific action payloads and continues execution", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(TwitchPlugin.effect);
      const schema = schemas.find(({ id }) => id === "SendChatMessage");
      assert.isDefined(schema);
      const calls: Array<unknown> = [];
      yield* schema.run({
        input: (ref) =>
          ref.id === "replyId"
            ? Option.some("parent-1")
            : ref.id === "broadcasterId"
              ? "channel-1"
              : "hello",
        output: () => undefined,
        properties: { account: AccountId.make("account-1") },
        event: undefined,
        engine: {
          SendChatMessage: (payload: unknown) =>
            Effect.sync(() => calls.push(payload)).pipe(
              Effect.as({ data: [{ message_id: "message-1", is_sent: true }] }),
            ),
        },
        execution,
        node,
      });
      assert.deepStrictEqual(calls, [
        {
          account_id: "account-1",
          broadcaster_id: "channel-1",
          sender_id: "account-1",
          message: "hello",
          reply_parent_message_id: "parent-1",
        },
      ]);
      assert.deepStrictEqual(
        schema.executionOutputs.map(({ id }) => id),
        ["exec"],
      );
    }),
  );

  it.effect("runs every active action and exposes continuation", () =>
    Effect.gen(function* () {
      const schemas = yield* Registration.collect(TwitchPlugin.effect);
      const calls: Array<string> = [];
      const response = (id: (typeof existingActionIds)[number]) => {
        switch (id) {
          case "GetChatSettings":
          case "UpdateChatSettings":
            return {
              data: [
                {
                  emote_mode: true,
                  follower_mode: false,
                  slow_mode: true,
                  subscriber_mode: false,
                },
              ],
            };
          case "GetChannelInformation":
            return {
              data: [
                {
                  broadcaster_id: "account-1",
                  broadcaster_login: "streamer",
                  broadcaster_name: "Streamer",
                  broadcaster_language: "en",
                  game_id: "game-1",
                  game_name: "Game",
                  title: "Title",
                },
              ],
            };
          case "GetStreams":
            return {
              data: [
                {
                  id: "stream-1",
                  user_id: "account-1",
                  game_name: "Game",
                  title: "Title",
                  viewer_count: 10,
                },
              ],
            };
          case "CreateClip":
            return { data: [{ id: "clip-1", edit_url: "https://clips.example/edit" }] };
          case "CreatePoll":
          case "EndPoll":
            return { data: [{ id: "poll-1" }] };
          case "CreatePrediction":
          case "EndPrediction":
            return { data: [{ id: "prediction-1" }] };
          case "GetUsers":
            return {
              data: [
                {
                  id: "account-1",
                  display_name: "Streamer",
                  broadcaster_type: "affiliate",
                  description: "Description",
                },
              ],
            };
          case "GetFollowers":
            return { total: 10 };
          case "SendChatMessage":
            return { data: [{ message_id: "message-1", is_sent: true }] };
          case "ModifyChannelInformation":
            return undefined;
        }
      };
      const engine = Object.fromEntries(
        existingActionIds.map((id) => [
          id,
          () =>
            Effect.sync(() => {
              calls.push(id);
              return response(id);
            }),
        ]),
      );

      for (const id of existingActionIds) {
        const schema = schemas.find((candidate) => candidate.id === id);
        assert.isDefined(schema);
        yield* schema.run({
          input: (ref) =>
            ref.type._tag === "Option"
              ? id === "UpdateChatSettings" && ref.id === "emoteMode"
                ? Option.some(true)
                : id === "ModifyChannelInformation" && ref.id === "title"
                  ? Option.some("Title")
                  : Option.none()
              : ref.type._tag === "Int"
                ? 60
                : ref.id === "status"
                  ? id === "EndPoll"
                    ? "TERMINATED"
                    : "CANCELED"
                  : ref.id === "moderatorId"
                    ? "account-1"
                    : "value",
          output: () => undefined,
          properties: { account: AccountId.make("account-1") },
          event: undefined,
          engine,
          execution,
          node,
        });
        assert.deepStrictEqual(
          schema.executionOutputs.map(({ id: outputId }) => outputId),
          ["exec"],
        );
      }
      assert.deepStrictEqual(calls, [...existingActionIds]);
    }),
  );
});
