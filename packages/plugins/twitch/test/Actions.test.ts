import { assert, describe, it } from "@effect/vitest";
import { EngineTest, Registration } from "@macrograph/plugin";
import { Effect, HashMap, Layer, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";

import { actions, mapResponse, prepare } from "../src/Actions.ts";
import { AccountId, TwitchEngine } from "../src/Definition.ts";
import { make } from "../src/Engine.ts";
import { HelixError } from "../src/Helix.ts";
import TwitchPlugin from "../src/Plugin.ts";

const accountId = AccountId.make("account-1");
const validationUrl = "https://id.twitch.tv/oauth2/validate";
const token = {
  user_id: accountId,
  client_id: "custom-client",
  scopes: actions.flatMap((action) => action.scopes),
  login: "streamer",
  expires_in: 3600,
};
const channel = { broadcasterId: accountId };
const modChannel = { broadcasterId: "channel-1" };
const broadcaster = { broadcaster_id: accountId };
const moderator = { broadcaster_id: "channel-1", moderator_id: accountId };
const reward = {
  id: "reward-1",
  title: "Reward",
  cost: 100,
  is_enabled: false,
  background_color: "#123456",
  max_per_stream_setting: { is_enabled: true, max_per_stream: 2 },
};
type Case = {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly inputs: Readonly<Record<string, Schema.Json>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body?: Schema.Json;
  readonly response: Schema.Json;
  readonly outputs?: Readonly<Record<string, unknown>>;
};
const cases: ReadonlyArray<Case> = [
  {
    id: "WarnUser",
    method: "POST",
    path: "/moderation/warnings",
    inputs: { ...modChannel, userId: "viewer-1", reason: "Rules" },
    query: moderator,
    body: { data: { user_id: "viewer-1", reason: "Rules" } },
    response: { data: [{ user_id: "viewer-1", reason: "Rules" }] },
  },
  {
    id: "BanUser",
    method: "POST",
    path: "/moderation/bans",
    inputs: { ...modChannel, userId: "viewer-1", duration: 60, reason: "Rules" },
    query: moderator,
    body: { data: { user_id: "viewer-1", duration: 60, reason: "Rules" } },
    response: { data: [{ user_id: "viewer-1", end_time: "2026-08-28T12:00:00Z" }] },
  },
  {
    id: "UnbanUser",
    method: "DELETE",
    path: "/moderation/bans",
    inputs: { ...modChannel, userId: "viewer-1" },
    query: { ...moderator, user_id: "viewer-1" },
    response: null,
  },
  {
    id: "AddModerator",
    method: "POST",
    path: "/moderation/moderators",
    inputs: { ...channel, userId: "viewer-1" },
    query: { ...broadcaster, user_id: "viewer-1" },
    response: null,
  },
  {
    id: "RemoveModerator",
    method: "DELETE",
    path: "/moderation/moderators",
    inputs: { ...channel, userId: "viewer-1" },
    query: { ...broadcaster, user_id: "viewer-1" },
    response: null,
  },
  {
    id: "AddVIP",
    method: "POST",
    path: "/channels/vips",
    inputs: { ...channel, userId: "viewer-1" },
    query: { ...broadcaster, user_id: "viewer-1" },
    response: null,
  },
  {
    id: "RemoveVIP",
    method: "DELETE",
    path: "/channels/vips",
    inputs: { ...channel, userId: "viewer-1" },
    query: { ...broadcaster, user_id: "viewer-1" },
    response: null,
  },
  {
    id: "CheckUserSubscription",
    method: "GET",
    path: "/subscriptions",
    inputs: { ...channel, userId: "viewer-1" },
    query: { ...broadcaster, user_id: "viewer-1" },
    response: {
      data: [{ user_id: "viewer-1", tier: "2000", is_gift: true, gifter_id: "gifter-1" }],
    },
    outputs: {
      subscribed: true,
      subscriptionJson: Option.some(
        JSON.stringify({ user_id: "viewer-1", tier: "2000", is_gift: true, gifter_id: "gifter-1" }),
      ),
    },
  },
  {
    id: "CheckUserFollow",
    method: "GET",
    path: "/channels/followers",
    inputs: { ...modChannel, userId: "viewer-1" },
    query: { broadcaster_id: "channel-1", user_id: "viewer-1" },
    response: { data: [{ user_id: "viewer-1", followed_at: "2026-08-28T12:00:00Z" }], total: 1 },
    outputs: { following: true, followedAt: Option.some("2026-08-28T12:00:00Z") },
  },
  {
    id: "CheckUserVIP",
    method: "GET",
    path: "/channels/vips",
    inputs: { ...channel, userId: "viewer-1" },
    query: { ...broadcaster, user_id: "viewer-1" },
    response: { data: [{ user_id: "viewer-1" }] },
    outputs: { vip: true },
  },
  {
    id: "CheckUserMod",
    method: "GET",
    path: "/moderation/moderators",
    inputs: { ...channel, userId: "viewer-1" },
    query: { ...broadcaster, user_id: "viewer-1" },
    response: { data: [{ user_id: "viewer-1" }] },
    outputs: { moderator: true },
  },
  {
    id: "SendWhisper",
    method: "POST",
    path: "/whispers",
    inputs: { userId: "viewer-1", message: "hello" },
    query: { from_user_id: accountId, to_user_id: "viewer-1" },
    body: { message: "hello" },
    response: null,
  },
  {
    id: "GetHypeTrain",
    method: "GET",
    path: "/hypetrain/status",
    inputs: channel,
    query: broadcaster,
    response: {
      data: [
        { current: null, all_time_high: { level: 5, total: 10000 }, shared_all_time_high: null },
      ],
    },
    outputs: { currentJson: Option.none() },
  },
  {
    id: "CreateCustomReward",
    method: "POST",
    path: "/channel_points/custom_rewards",
    inputs: {
      ...channel,
      title: "Reward",
      cost: 100,
      optionsJson:
        '{"is_enabled":false,"background_color":"#123456","is_max_per_stream_enabled":true,"max_per_stream":2}',
    },
    query: broadcaster,
    body: {
      title: "Reward",
      cost: 100,
      is_enabled: false,
      background_color: "#123456",
      is_max_per_stream_enabled: true,
      max_per_stream: 2,
    },
    response: { data: [reward] },
    outputs: { rewardJson: JSON.stringify(reward) },
  },
  {
    id: "EditCustomReward",
    method: "PATCH",
    path: "/channel_points/custom_rewards",
    inputs: {
      ...channel,
      rewardId: "reward-1",
      changesJson: '{"prompt":"","is_enabled":false,"is_global_cooldown_enabled":false}',
    },
    query: { ...broadcaster, id: "reward-1" },
    body: { prompt: "", is_enabled: false, is_global_cooldown_enabled: false },
    response: { data: [reward] },
    outputs: { rewardJson: JSON.stringify(reward) },
  },
  {
    id: "DeleteCustomReward",
    method: "DELETE",
    path: "/channel_points/custom_rewards",
    inputs: { ...channel, rewardId: "reward-1" },
    query: { ...broadcaster, id: "reward-1" },
    response: null,
  },
  {
    id: "UpdateRedemptionStatus",
    method: "PATCH",
    path: "/channel_points/custom_rewards/redemptions",
    inputs: { ...channel, rewardId: "reward-1", redemptionId: "redemption-1", status: "FULFILLED" },
    query: { ...broadcaster, reward_id: "reward-1", id: "redemption-1" },
    body: { status: "FULFILLED" },
    response: { data: [{ id: "redemption-1", status: "FULFILLED", reward }] },
    outputs: {
      redemptionJson: JSON.stringify({ id: "redemption-1", status: "FULFILLED", reward }),
    },
  },
  {
    id: "GetRewardByTitle",
    method: "GET",
    path: "/channel_points/custom_rewards",
    inputs: { ...channel, title: "Reward", manageableOnly: false },
    query: { ...broadcaster, only_manageable_rewards: "false" },
    response: { data: [{ id: "other", title: "Other" }, reward] },
    outputs: { rewardJson: Option.some(JSON.stringify(reward)) },
  },
  {
    id: "StartCommercial",
    method: "POST",
    path: "/channels/commercial",
    inputs: { ...channel, duration: 90 },
    query: {},
    body: { broadcaster_id: accountId, length: 90 },
    response: { data: [{ length: 90, message: "", retry_after: 480 }] },
    outputs: { retryAfter: 480 },
  },
  {
    id: "GetAdSchedule",
    method: "GET",
    path: "/channels/ads",
    inputs: channel,
    query: broadcaster,
    response: {
      data: [
        {
          next_ad_at: "2026-08-28T12:00:00Z",
          duration: 60,
          snooze_count: 1,
          preroll_free_time: 90,
        },
      ],
    },
  },
  {
    id: "SnoozeNextAd",
    method: "POST",
    path: "/channels/ads/schedule/snooze",
    inputs: channel,
    query: broadcaster,
    response: {
      data: [
        {
          snooze_count: 0,
          next_ad_at: "2026-08-28T12:05:00Z",
          snooze_refresh_at: "2026-08-28T13:00:00Z",
        },
      ],
    },
  },
  {
    id: "GetChatters",
    method: "GET",
    path: "/chat/chatters",
    inputs: { ...modChannel, first: 1000, after: "a&b" },
    query: { ...moderator, first: "1000", after: "a&b" },
    response: {
      data: [{ user_id: "viewer-1", user_login: "viewer", user_name: "Viewer" }],
      total: 2,
      pagination: { cursor: "next-page" },
    },
    outputs: { cursor: Option.some("next-page") },
  },
  {
    id: "GetUserChatColorByID",
    method: "GET",
    path: "/chat/color",
    inputs: { userId: "viewer-1" },
    query: { user_id: "viewer-1" },
    response: { data: [{ user_id: "viewer-1", color: "#123456" }] },
    outputs: { color: Option.some("#123456") },
  },
  {
    id: "ModerationChatDelay",
    method: "PATCH",
    path: "/chat/settings",
    inputs: { ...modChannel, enabled: true, duration: 4 },
    query: moderator,
    body: { non_moderator_chat_delay: true, non_moderator_chat_delay_duration: 4 },
    response: { data: [{ non_moderator_chat_delay: true, non_moderator_chat_delay_duration: 4 }] },
  },
  {
    id: "UniqueChatMode",
    method: "PATCH",
    path: "/chat/settings",
    inputs: { ...modChannel, enabled: false },
    query: moderator,
    body: { unique_chat_mode: false },
    response: { data: [{ unique_chat_mode: false }] },
  },
  {
    id: "DeleteChatMessage",
    method: "DELETE",
    path: "/moderation/chat",
    inputs: { ...modChannel, messageId: "message-1" },
    query: { ...moderator, message_id: "message-1" },
    response: null,
  },
  {
    id: "ShoutoutUser",
    method: "POST",
    path: "/chat/shoutouts",
    inputs: { ...modChannel, userId: "streamer-2" },
    query: {
      from_broadcaster_id: "channel-1",
      moderator_id: accountId,
      to_broadcaster_id: "streamer-2",
    },
    response: null,
  },
  {
    id: "SendAnnouncement",
    method: "POST",
    path: "/chat/announcements",
    inputs: { ...modChannel, message: "hello", color: "primary" },
    query: moderator,
    body: { message: "hello", color: "primary" },
    response: null,
  },
  {
    id: "ValidateToken",
    method: "GET",
    path: validationUrl,
    inputs: {},
    query: {},
    response: token,
    outputs: { login: "streamer", userId: accountId, expiresIn: 3600 },
  },
  {
    id: "GetPolls",
    method: "GET",
    path: "/polls",
    inputs: { ...channel, pollId: "poll-1", first: 20, after: "previous-page" },
    query: { ...broadcaster, id: "poll-1", first: "20", after: "previous-page" },
    response: {
      data: [
        {
          id: "poll-1",
          title: "Question",
          choices: [
            { title: "Yes", votes: 5 },
            { title: "No", votes: 2 },
          ],
          status: "COMPLETED",
        },
      ],
      pagination: {},
    },
    outputs: { cursor: Option.none() },
  },
];

type HttpCall = {
  readonly method: string;
  readonly url: string;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly headers: Readonly<Record<string, string>>;
};
const setup = Effect.fnUntraced(function* (
  options: {
    scopes?: ReadonlyArray<string>;
    credentialAvailable?: boolean;
    validationUnavailable?: boolean;
  } = {},
) {
  const calls: Array<HttpCall> = [];
  let response: Schema.Json = { data: [] };
  let statuses: ReadonlyArray<number> = [200];
  let attempt = 0;
  let refreshes = 0;
  let access = "credential-secret";
  const credential = () => ({
    id: accountId,
    provider: "twitch",
    clientId: "custom-client",
    token: { access: Redacted.make(access) },
  });
  const http = HttpClient.make((request) =>
    Effect.suspend(() => {
      calls.push({
        method: request.method,
        url: request.url,
        query: Object.fromEntries(request.urlParams),
        body:
          request.body._tag === "Uint8Array"
            ? JSON.parse(new TextDecoder().decode(request.body.body))
            : undefined,
        headers: { ...request.headers },
      });
      if (request.url === validationUrl && options.validationUnavailable)
        return Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request }),
          }),
        );
      const validation = request.url === validationUrl;
      const status = validation ? 200 : (statuses[Math.min(attempt++, statuses.length - 1)] ?? 200);
      const body = validation ? { ...token, scopes: options.scopes ?? token.scopes } : response;
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(status === 204 ? null : JSON.stringify(body), {
            status,
            headers: {
              "content-type": "application/json",
              "ratelimit-remaining": "0",
              "ratelimit-reset": "123456",
            },
          }),
        ),
      );
    }),
  );
  const dependencies = Layer.mergeAll(
    Layer.succeed(HttpClient.HttpClient)(http),
    Layer.succeed(TwitchEngine.EngineContext)({
      storage: {
        get: Effect.succeed({ accounts: {} }),
        set: () => Effect.void,
        update: () => Effect.void,
      },
      resource: { refresh: () => Effect.void },
      client: { refresh: Effect.void },
      emit: () => Effect.void,
      credentials: {
        get: Effect.sync(() => (options.credentialAvailable === false ? [] : [credential()])),
        refresh: () =>
          Effect.sync(() => {
            refreshes++;
            access = "refreshed-secret";
            return credential();
          }),
        subscribe: () => Effect.void,
      },
    }),
  );
  const { runtime } = yield* EngineTest.makeClients(TwitchEngine).pipe(
    Effect.provide(
      make(() =>
        Effect.succeed({
          transport: "websocket",
          state: Effect.succeed(HashMap.empty()),
          connect: () => Effect.void,
          disconnect: () => Effect.void,
        }),
      ).pipe(Layer.provide(dependencies)),
    ),
  );
  return {
    runtime,
    calls,
    refreshes: () => refreshes,
    respond: (body: Schema.Json, codes: ReadonlyArray<number> = [200]) => {
      response = body;
      statuses = codes;
      attempt = 0;
    },
  };
});
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

describe("Twitch authenticated action nodes", () => {
  it.effect(
    "stops catalog execution without writing outputs when runtime authorization fails",
    () =>
      Effect.gen(function* () {
        const test = yield* setup({ scopes: [] });
        const schemas = yield* Registration.collect(TwitchPlugin.effect);
        const schema = schemas.find(({ id }) => id === "CheckUserSubscription")!;
        const outputs = new Map<string, unknown>();
        const error = yield* Effect.flip(
          schema.run({
            input: (ref) => (ref.id === "broadcasterId" ? accountId : "viewer-1"),
            output: (ref, value) => outputs.set(ref.id, value),
            properties: { account: accountId },
            engine: test.runtime,
            event: undefined,
            execution,
            node,
          }),
        );
        assert.isDefined(error);
        assert.strictEqual(outputs.size, 0);
        assert.strictEqual(test.calls.length, 1);
      }),
  );
  it.effect("runs all 30 catalog actions through runtime RPC and the HTTP transport", () =>
    Effect.gen(function* () {
      const test = yield* setup();
      const schemas = yield* Registration.collect(TwitchPlugin.effect);
      assert.strictEqual(cases.length, 30);
      assert.deepStrictEqual(
        cases.map(({ id }) => id),
        actions.map(({ id }) => id),
      );
      for (const fixture of cases) {
        const schema = schemas.find(({ id }) => id === fixture.id);
        assert.isDefined(schema);
        test.respond(fixture.response, [fixture.response === null ? 204 : 200]);
        const outputs = new Map<string, unknown>();
        yield* schema.run({
          input: (ref) =>
            ref.type._tag === "Option"
              ? Option.fromNullishOr(fixture.inputs[ref.id])
              : fixture.inputs[ref.id],
          output: (ref, value) => outputs.set(ref.id, value),
          properties: { account: accountId },
          engine: test.runtime,
          event: undefined,
          execution,
          node,
        });
        const call = test.calls.at(-1)!;
        assert.strictEqual(call.method, fixture.method, fixture.id);
        assert.strictEqual(
          call.url,
          fixture.path === validationUrl
            ? validationUrl
            : `https://api.twitch.tv/helix${fixture.path}`,
          fixture.id,
        );
        assert.deepStrictEqual(call.query, fixture.query, fixture.id);
        assert.deepStrictEqual(call.body, fixture.body, fixture.id);
        assert.deepStrictEqual(
          call.headers,
          fixture.id === "ValidateToken"
            ? { authorization: "Bearer credential-secret" }
            : {
                authorization: "Bearer credential-secret",
                "client-id": "custom-client",
                "content-type": "application/json",
              },
          fixture.id,
        );
        assert.strictEqual(
          outputs.get("responseJson"),
          JSON.stringify(fixture.response),
          fixture.id,
        );
        for (const [id, value] of Object.entries(fixture.outputs ?? {}))
          assert.deepStrictEqual(outputs.get(id), value, `${fixture.id}.${id}`);
        assert.deepStrictEqual(
          schema.executionOutputs.map(({ id }) => id),
          ["exec"],
        );
      }
      assert.strictEqual(test.calls.filter(({ url }) => url === validationUrl).length, 2);
    }),
  );

  it.effect("uses omission for permanent bans, optional pagination and disabled delays", () =>
    Effect.gen(function* () {
      const ban = yield* prepare("BanUser", { ...modChannel, userId: "viewer-1" }, accountId);
      assert.deepStrictEqual(ban.body, { data: { user_id: "viewer-1" } });
      const delay = yield* prepare(
        "ModerationChatDelay",
        { ...modChannel, enabled: false, duration: 6 },
        accountId,
      );
      assert.deepStrictEqual(delay.body, { non_moderator_chat_delay: false });
      const chatters = yield* prepare("GetChatters", modChannel, accountId);
      assert.deepStrictEqual(chatters.query, moderator);
    }),
  );

  it.effect("distinguishes absent users, rewards, colors and inactive hype trains", () =>
    Effect.gen(function* () {
      for (const [id, flag] of [
        ["CheckUserSubscription", "subscribed"],
        ["CheckUserFollow", "following"],
        ["CheckUserVIP", "vip"],
        ["CheckUserMod", "moderator"],
      ]) {
        const outputs = yield* mapResponse(id!, { userId: "viewer-1" }, { data: [], total: 0 });
        assert.strictEqual(outputs[flag!], false);
      }
      assert.deepStrictEqual(
        yield* mapResponse("CheckUserFollow", { userId: "viewer-1" }, { data: [] }),
        { following: false, followedAt: null },
      );
      assert.deepStrictEqual(
        yield* mapResponse("GetRewardByTitle", { title: "reward" }, { data: [reward] }),
        { rewardJson: null },
      );
      assert.deepStrictEqual(yield* mapResponse("GetUserChatColorByID", {}, { data: [] }), {
        color: null,
      });
      assert.deepStrictEqual(
        yield* mapResponse("GetUserChatColorByID", {}, { data: [{ color: "" }] }),
        { color: null },
      );
      const current = {
        id: "hype-1",
        level: 5,
        goal: 1000,
        total: 5000,
        expires_at: "2026-08-28T12:00:00Z",
      };
      assert.deepStrictEqual(yield* mapResponse("GetHypeTrain", {}, { data: [{ current }] }), {
        currentJson: current,
      });
    }),
  );

  it.effect("rejects malformed mapped responses rather than inventing values", () =>
    Effect.gen(function* () {
      for (const [id, response, reason] of [
        ["NotAnAction", null, "Unknown Twitch action"],
        ["UnbanUser", { data: [] }, "Twitch returned an invalid action response"],
        ["CheckUserVIP", { data: [42] }, "Twitch returned invalid data entries"],
        [
          "CheckUserMod",
          { data: [{ user_id: "other" }] },
          "Twitch returned an invalid user lookup",
        ],
        [
          "CheckUserVIP",
          { data: [{ user_id: "viewer-1" }, { user_id: "viewer-1" }] },
          "Twitch returned an invalid user lookup",
        ],
        ["CheckUserFollow", { data: [{ user_id: "viewer-1" }] }, "Twitch omitted followedAt"],
        ["GetHypeTrain", { data: [{}] }, "Twitch omitted currentJson"],
        ["GetHypeTrain", { data: [{ current: [] }] }, "Twitch returned invalid currentJson"],
        ["GetChatters", { data: "invalid" }, "Twitch returned an invalid action response"],
        ["CreateCustomReward", { data: [] }, "Twitch returned invalid rewardJson"],
        ["StartCommercial", { data: [{ retry_after: "480" }] }, "retryAfter must be int"],
        ["StartCommercial", { data: [{ retry_after: 0.5 }] }, "retryAfter must be int"],
        ["GetUserChatColorByID", { data: [{ color: 123 }] }, "color must be string"],
        [
          "ValidateToken",
          { login: 12, user_id: "viewer-1", expires_in: 100 },
          "Twitch returned an invalid token validation response",
        ],
      ] as const) {
        const error = yield* Effect.flip(mapResponse(id, { userId: "viewer-1" }, response));
        assert.instanceOf(error, HelixError);
        assert.strictEqual(error.reason, reason, id);
      }
    }),
  );

  it.effect("rejects invalid and unknown inputs at the RPC boundary before HTTP", () =>
    Effect.gen(function* () {
      const test = yield* setup();
      const invalid: ReadonlyArray<readonly [string, Readonly<Record<string, Schema.Json>>]> = [
        ["NotAnAction", {}],
        ["WarnUser", { ...modChannel, userId: "viewer-1" }],
        ["WarnUser", { ...modChannel, userId: "viewer-1", reason: "" }],
        ["WarnUser", { ...modChannel, userId: "viewer-1", reason: 42 }],
        ["BanUser", { ...modChannel, userId: "viewer-1", duration: 0 }],
        ["BanUser", { ...modChannel, userId: "viewer-1", duration: 0.5 }],
        ["BanUser", { ...modChannel, userId: "viewer-1", duration: 1209601 }],
        ["DeleteChatMessage", { ...modChannel, messageId: "" }],
        ["GetChatters", { ...modChannel, first: 1001 }],
        ["GetPolls", { ...channel, first: 21 }],
        ["ModerationChatDelay", { ...modChannel, enabled: true, duration: 3 }],
        [
          "UpdateRedemptionStatus",
          { ...channel, rewardId: "reward-1", redemptionId: "redemption-1", status: "UNFULFILLED" },
        ],
        ["StartCommercial", { ...channel, duration: 45 }],
        ["SendAnnouncement", { ...modChannel, message: "hello", color: "red" }],
        ["EditCustomReward", { ...channel, rewardId: "reward-1", changesJson: "{}" }],
        ["EditCustomReward", { ...channel, rewardId: "reward-1", changesJson: "[]" }],
        ["EditCustomReward", { ...channel, rewardId: "reward-1", changesJson: "{" }],
        ["EditCustomReward", { ...channel, rewardId: "reward-1", changesJson: "null" }],
        ["EditCustomReward", { ...channel, rewardId: "reward-1", changesJson: {} }],
        [
          "EditCustomReward",
          { ...channel, rewardId: "reward-1", changesJson: '{"background_color":"red"}' },
        ],
        [
          "CreateCustomReward",
          { ...channel, title: "Reward", cost: 100, optionsJson: '{"broadcaster_id":"other"}' },
        ],
        [
          "CreateCustomReward",
          {
            ...channel,
            title: "Reward",
            cost: 100,
            optionsJson: '{"is_global_cooldown_enabled":true}',
          },
        ],
        [
          "CreateCustomReward",
          { ...channel, title: "Reward", cost: 100, optionsJson: '{"is_enabled":"false"}' },
        ],
        ["GetChatters", { ...modChannel, moderatorId: "other" }],
      ];
      for (const [action, inputs] of invalid) {
        const validationError = yield* Effect.flip(prepare(action, inputs, accountId));
        assert.instanceOf(validationError, HelixError);
        const error = yield* Effect.flip(
          test.runtime.ExecuteAction({ account_id: accountId, action, inputs }),
        );
        assert.strictEqual(error._tag, "HelixError", action);
        if (error._tag === "HelixError")
          assert.strictEqual(error.reason, validationError.reason, action);
      }
      assert.isEmpty(test.calls);
    }),
  );

  it.effect("enforces every action scope and broadcaster identity before the action request", () =>
    Effect.gen(function* () {
      const test = yield* setup({ scopes: [] });
      for (const fixture of cases.filter(
        ({ id }) => actions.find((action) => action.id === id)?.scopes.length,
      )) {
        const error = yield* Effect.flip(
          test.runtime.ExecuteAction({
            account_id: accountId,
            action: fixture.id,
            inputs: fixture.inputs,
          }),
        );
        assert.strictEqual(error._tag, "TwitchCredentialAuthorizationError", fixture.id);
      }
      assert.strictEqual(test.calls.length, 1);
      const authorized = yield* setup();
      for (const fixture of cases.filter(
        ({ id }) => actions.find((action) => action.id === id)?.role === "broadcaster",
      )) {
        const error = yield* Effect.flip(
          authorized.runtime.ExecuteAction({
            account_id: accountId,
            action: fixture.id,
            inputs: { ...fixture.inputs, broadcasterId: "other" },
          }),
        );
        assert.strictEqual(error._tag, "TwitchCredentialAuthorizationError", fixture.id);
      }
      assert.isEmpty(authorized.calls);
      const missing = yield* setup({ credentialAvailable: false });
      assert.strictEqual(
        (yield* Effect.flip(
          missing.runtime.ExecuteAction({
            account_id: accountId,
            action: "GetHypeTrain",
            inputs: channel,
          }),
        ))._tag,
        "MissingCredential",
      );
      assert.isEmpty(missing.calls);
    }),
  );

  it.effect("accepts read OR manage scopes, not both", () =>
    Effect.gen(function* () {
      for (const [action, scopes] of [
        ["CheckUserVIP", ["channel:read:vips", "channel:manage:vips"]],
        ["CheckUserMod", ["moderation:read", "channel:manage:moderators"]],
        ["GetRewardByTitle", ["channel:read:redemptions", "channel:manage:redemptions"]],
        ["GetPolls", ["channel:read:polls", "channel:manage:polls"]],
      ] as const) {
        const fixture = cases.find(({ id }) => id === action)!;
        for (const scope of scopes) {
          const test = yield* setup({ scopes: [scope] });
          test.respond(fixture.response);
          yield* test.runtime.ExecuteAction({
            account_id: accountId,
            action,
            inputs: fixture.inputs,
          });
          assert.strictEqual(test.calls.length, 2);
        }
      }
    }),
  );

  it.effect(
    "refreshes on 401 once, preserves HTTP errors and rate limits, and fails malformed JSON shapes",
    () =>
      Effect.gen(function* () {
        const test = yield* setup({ validationUnavailable: true });
        const fixture = cases.find(({ id }) => id === "WarnUser")!;
        const run = test.runtime.ExecuteAction({
          account_id: accountId,
          action: fixture.id,
          inputs: fixture.inputs,
        });
        test.respond(fixture.response, [401, 200]);
        yield* run;
        assert.strictEqual(test.refreshes(), 1);
        assert.strictEqual(test.calls.at(-1)!.headers.authorization, "Bearer refreshed-secret");
        for (const status of [400, 401, 403, 404, 429, 503]) {
          test.respond({ message: "Twitch action rejected", access_token: "response-secret" }, [
            status,
          ]);
          const error = yield* Effect.flip(run);
          assert.strictEqual(error._tag, "HelixError");
          if (error._tag === "HelixError") {
            assert.strictEqual(error.status, status);
            assert.strictEqual(error.reason, "Twitch action rejected");
            assert.strictEqual(error.rateLimitRemaining, 0);
            assert.strictEqual(error.rateLimitReset, 123456);
            assert.notInclude(error.reason, "secret");
          }
        }
        test.respond({ data: "wrong" });
        assert.strictEqual((yield* Effect.flip(run))._tag, "HelixError");
        const unavailable = yield* Effect.flip(
          test.runtime.ExecuteAction({
            account_id: accountId,
            action: "ValidateToken",
            inputs: {},
          }),
        );
        assert.strictEqual(unavailable._tag, "HelixError");
      }),
  );

  it.effect(
    "forwards reply IDs and valid follower/slow durations through the existing HTTP endpoints",
    () =>
      Effect.gen(function* () {
        const test = yield* setup({
          scopes: ["moderator:manage:chat_settings", "user:write:chat"],
        });
        const schemas = yield* Registration.collect(TwitchPlugin.effect);
        const settings = schemas.find(({ id }) => id === "UpdateChatSettings")!;
        const inputs: Readonly<Record<string, unknown>> = {
          broadcasterId: "channel-1",
          moderatorId: accountId,
          followerMode: Option.some(true),
          followerDuration: Option.some(0),
          slowMode: Option.some(true),
          slowDuration: Option.some(3),
        };
        test.respond({
          data: [
            { emote_mode: false, follower_mode: true, slow_mode: true, subscriber_mode: false },
          ],
        });
        yield* settings.run({
          input: (ref) => inputs[ref.id] ?? Option.none(),
          output: () => undefined,
          properties: { account: accountId },
          engine: test.runtime,
          event: undefined,
          execution,
          node,
        });
        assert.deepStrictEqual(test.calls.at(-1)!.body, {
          follower_mode: true,
          follower_mode_duration: 0,
          slow_mode: true,
          slow_mode_wait_time: 3,
        });
        yield* settings.run({
          input: (ref) =>
            ref.id === "slowMode" || ref.id === "followerMode"
              ? Option.some(false)
              : (inputs[ref.id] ?? Option.none()),
          output: () => undefined,
          properties: { account: accountId },
          engine: test.runtime,
          event: undefined,
          execution,
          node,
        });
        assert.deepStrictEqual(test.calls.at(-1)!.body, { follower_mode: false, slow_mode: false });
        const chat = schemas.find(({ id }) => id === "SendChatMessage")!;
        test.respond({ data: [{ message_id: "message-2", is_sent: true, drop_reason: null }] });
        for (const reply of [Option.none<string>(), Option.some(""), Option.some("parent-1")]) {
          yield* chat.run({
            input: (ref) =>
              ref.id === "replyId" ? reply : ref.id === "broadcasterId" ? "channel-1" : "hello",
            output: () => undefined,
            properties: { account: accountId },
            engine: test.runtime,
            event: undefined,
            execution,
            node,
          });
          assert.deepStrictEqual(test.calls.at(-1)!.body, {
            broadcaster_id: "channel-1",
            sender_id: accountId,
            message: "hello",
            ...(Option.isSome(reply) && reply.value
              ? { reply_parent_message_id: reply.value }
              : {}),
          });
        }
        test.respond({
          data: [
            {
              message_id: "",
              is_sent: false,
              drop_reason: { code: "automod_held", message: "Held by AutoMod" },
            },
          ],
        });
        const error = yield* Effect.flip(
          chat.run({
            input: (ref) => (ref.id === "replyId" ? Option.none() : "hello"),
            output: () => undefined,
            properties: { account: accountId },
            engine: test.runtime,
            event: undefined,
            execution,
            node,
          }),
        );
        assert.instanceOf(error, Error);
      }),
  );
});
