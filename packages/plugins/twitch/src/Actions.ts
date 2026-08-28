import { Effect, Schema } from "effect";

import { HelixError } from "./Helix.ts";

export type Input = {
  readonly id: string;
  readonly key?: string;
  readonly kind?: "string" | "int" | "bool" | "json";
  readonly location?: "query" | "body" | "data" | "local";
  readonly optional?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly values?: ReadonlyArray<string | number>;
};
type Output = {
  readonly id: string;
  readonly path: string;
  readonly kind: "string" | "int" | "bool" | "json" | "exists";
  readonly optional?: boolean;
};
type Action = {
  readonly id: string;
  readonly name: string;
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly path: string;
  readonly scopes: ReadonlyArray<string>;
  readonly role?: "broadcaster" | "moderator" | "sender";
  readonly inputs: ReadonlyArray<Input>;
  readonly outputs?: ReadonlyArray<Output>;
  readonly noContent?: boolean;
};
const channel: Input = { id: "broadcasterId", key: "broadcaster_id" };
const user: Input = { id: "userId", key: "user_id" };
const reward: Input = { id: "rewardId", key: "id" };
const enabled: Input = { id: "enabled", kind: "bool", location: "body" };
const after: Input = { id: "after", optional: true };
const first = (max: number): Input => ({ id: "first", kind: "int", min: 1, max, optional: true });
const exists = (id: string): Output => ({ id, path: "data.0", kind: "exists" });
const json = (id: string, path = "data.0", optional = true): Output => ({
  id,
  path,
  kind: "json",
  optional,
});

// Scope lists are alternatives, not cumulative requirements.
export const actions: ReadonlyArray<Action> = [
  {
    id: "WarnUser",
    name: "Warn User",
    method: "POST",
    path: "/moderation/warnings",
    scopes: ["moderator:manage:warnings"],
    role: "moderator",
    inputs: [
      channel,
      { ...user, location: "data" },
      { id: "reason", location: "data", min: 1, max: 500 },
    ],
  },
  {
    id: "BanUser",
    name: "Ban User",
    method: "POST",
    path: "/moderation/bans",
    scopes: ["moderator:manage:banned_users"],
    role: "moderator",
    inputs: [
      channel,
      { ...user, location: "data" },
      { id: "duration", kind: "int", location: "data", optional: true, min: 1, max: 1209600 },
      { id: "reason", location: "data", optional: true, max: 500 },
    ],
  },
  {
    id: "UnbanUser",
    name: "Unban User",
    method: "DELETE",
    path: "/moderation/bans",
    scopes: ["moderator:manage:banned_users"],
    role: "moderator",
    inputs: [channel, user],
    noContent: true,
  },
  ...(["Add", "Remove"] as const).map(
    (verb): Action => ({
      id: `${verb}Moderator`,
      name: `${verb} Moderator`,
      method: verb === "Add" ? "POST" : "DELETE",
      path: "/moderation/moderators",
      scopes: ["channel:manage:moderators"],
      role: "broadcaster",
      inputs: [channel, user],
      noContent: true,
    }),
  ),
  ...(["Add", "Remove"] as const).map(
    (verb): Action => ({
      id: `${verb}VIP`,
      name: `${verb} VIP`,
      method: verb === "Add" ? "POST" : "DELETE",
      path: "/channels/vips",
      scopes: ["channel:manage:vips"],
      role: "broadcaster",
      inputs: [channel, user],
      noContent: true,
    }),
  ),
  {
    id: "CheckUserSubscription",
    name: "Check User Subscription",
    method: "GET",
    path: "/subscriptions",
    scopes: ["channel:read:subscriptions"],
    role: "broadcaster",
    inputs: [channel, user],
    outputs: [exists("subscribed"), json("subscriptionJson")],
  },
  {
    id: "CheckUserFollow",
    name: "Check User Follow",
    method: "GET",
    path: "/channels/followers",
    scopes: ["moderator:read:followers"],
    inputs: [channel, user],
    outputs: [
      exists("following"),
      { id: "followedAt", path: "data.0.followed_at", kind: "string", optional: true },
    ],
  },
  {
    id: "CheckUserVIP",
    name: "Check User VIP",
    method: "GET",
    path: "/channels/vips",
    scopes: ["channel:read:vips", "channel:manage:vips"],
    role: "broadcaster",
    inputs: [channel, user],
    outputs: [exists("vip")],
  },
  {
    id: "CheckUserMod",
    name: "Check User Mod",
    method: "GET",
    path: "/moderation/moderators",
    scopes: ["moderation:read", "channel:manage:moderators"],
    role: "broadcaster",
    inputs: [channel, user],
    outputs: [exists("moderator")],
  },
  {
    id: "SendWhisper",
    name: "Send Whisper",
    method: "POST",
    path: "/whispers",
    scopes: ["user:manage:whispers"],
    role: "sender",
    inputs: [
      { id: "userId", key: "to_user_id" },
      { id: "message", location: "body", min: 1 },
    ],
    noContent: true,
  },
  {
    id: "GetHypeTrain",
    name: "Get Hype Train",
    method: "GET",
    path: "/hypetrain/status",
    scopes: ["channel:read:hype_train"],
    role: "broadcaster",
    inputs: [channel],
    outputs: [json("currentJson", "data.0.current")],
  },
  {
    id: "CreateCustomReward",
    name: "Create Custom Reward",
    method: "POST",
    path: "/channel_points/custom_rewards",
    scopes: ["channel:manage:redemptions"],
    role: "broadcaster",
    inputs: [
      channel,
      { id: "title", location: "body", min: 1, max: 45 },
      { id: "cost", location: "body", kind: "int", min: 1 },
      { id: "optionsJson", kind: "json", location: "local", optional: true },
    ],
    outputs: [json("rewardJson", "data.0", false)],
  },
  {
    id: "EditCustomReward",
    name: "Edit Custom Reward",
    method: "PATCH",
    path: "/channel_points/custom_rewards",
    scopes: ["channel:manage:redemptions"],
    role: "broadcaster",
    inputs: [channel, reward, { id: "changesJson", kind: "json", location: "local" }],
    outputs: [json("rewardJson", "data.0", false)],
  },
  {
    id: "DeleteCustomReward",
    name: "Delete Custom Reward",
    method: "DELETE",
    path: "/channel_points/custom_rewards",
    scopes: ["channel:manage:redemptions"],
    role: "broadcaster",
    inputs: [channel, reward],
    noContent: true,
  },
  {
    id: "UpdateRedemptionStatus",
    name: "Update Redemption Status",
    method: "PATCH",
    path: "/channel_points/custom_rewards/redemptions",
    scopes: ["channel:manage:redemptions"],
    role: "broadcaster",
    inputs: [
      channel,
      { id: "rewardId", key: "reward_id" },
      { id: "redemptionId", key: "id" },
      { id: "status", location: "body", values: ["FULFILLED", "CANCELED"] },
    ],
    outputs: [json("redemptionJson", "data.0", false)],
  },
  {
    id: "GetRewardByTitle",
    name: "Get Reward By Title",
    method: "GET",
    path: "/channel_points/custom_rewards",
    scopes: ["channel:read:redemptions", "channel:manage:redemptions"],
    role: "broadcaster",
    inputs: [
      channel,
      { id: "title", location: "local", min: 1 },
      { id: "manageableOnly", key: "only_manageable_rewards", kind: "bool" },
    ],
    outputs: [json("rewardJson", "match")],
  },
  {
    id: "StartCommercial",
    name: "Start Commercial",
    method: "POST",
    path: "/channels/commercial",
    scopes: ["channel:edit:commercial"],
    role: "broadcaster",
    inputs: [
      { ...channel, location: "body" },
      {
        id: "duration",
        key: "length",
        kind: "int",
        location: "body",
        values: [30, 60, 90, 120, 150, 180],
      },
    ],
    outputs: [{ id: "retryAfter", path: "data.0.retry_after", kind: "int" }],
  },
  {
    id: "GetAdSchedule",
    name: "Get Ad Schedule",
    method: "GET",
    path: "/channels/ads",
    scopes: ["channel:read:ads"],
    role: "broadcaster",
    inputs: [channel],
  },
  {
    id: "SnoozeNextAd",
    name: "Snooze Next Ad",
    method: "POST",
    path: "/channels/ads/schedule/snooze",
    scopes: ["channel:manage:ads"],
    role: "broadcaster",
    inputs: [channel],
  },
  {
    id: "GetChatters",
    name: "Get Chatters",
    method: "GET",
    path: "/chat/chatters",
    scopes: ["moderator:read:chatters"],
    role: "moderator",
    inputs: [channel, first(1000), after],
    outputs: [{ id: "cursor", path: "pagination.cursor", kind: "string", optional: true }],
  },
  {
    id: "GetUserChatColorByID",
    name: "Get User Chat Color By ID",
    method: "GET",
    path: "/chat/color",
    scopes: [],
    inputs: [user],
    outputs: [{ id: "color", path: "data.0.color", kind: "string", optional: true }],
  },
  {
    id: "ModerationChatDelay",
    name: "Moderation Chat Delay",
    method: "PATCH",
    path: "/chat/settings",
    scopes: ["moderator:manage:chat_settings"],
    role: "moderator",
    inputs: [
      channel,
      { ...enabled, key: "non_moderator_chat_delay" },
      {
        id: "duration",
        key: "non_moderator_chat_delay_duration",
        location: "body",
        kind: "int",
        optional: true,
        values: [2, 4, 6],
      },
    ],
  },
  {
    id: "UniqueChatMode",
    name: "Unique Chat Mode",
    method: "PATCH",
    path: "/chat/settings",
    scopes: ["moderator:manage:chat_settings"],
    role: "moderator",
    inputs: [channel, { ...enabled, key: "unique_chat_mode" }],
  },
  {
    id: "DeleteChatMessage",
    name: "Delete Chat Message",
    method: "DELETE",
    path: "/moderation/chat",
    scopes: ["moderator:manage:chat_messages"],
    role: "moderator",
    inputs: [channel, { id: "messageId", key: "message_id" }],
    noContent: true,
  },
  {
    id: "ShoutoutUser",
    name: "Shoutout User",
    method: "POST",
    path: "/chat/shoutouts",
    scopes: ["moderator:manage:shoutouts"],
    role: "moderator",
    inputs: [
      { ...channel, key: "from_broadcaster_id" },
      { id: "userId", key: "to_broadcaster_id" },
    ],
    noContent: true,
  },
  {
    id: "SendAnnouncement",
    name: "Send Announcement",
    method: "POST",
    path: "/chat/announcements",
    scopes: ["moderator:manage:announcements"],
    role: "moderator",
    inputs: [
      channel,
      { id: "message", location: "body", min: 1, max: 500 },
      {
        id: "color",
        location: "body",
        optional: true,
        values: ["blue", "green", "orange", "purple", "primary"],
      },
    ],
    noContent: true,
  },
  {
    id: "ValidateToken",
    name: "Validate Token",
    method: "GET",
    path: "https://id.twitch.tv/oauth2/validate",
    scopes: [],
    inputs: [],
    outputs: [
      { id: "login", path: "login", kind: "string" },
      { id: "userId", path: "user_id", kind: "string" },
      { id: "expiresIn", path: "expires_in", kind: "int" },
    ],
  },
  {
    id: "GetPolls",
    name: "Get Polls",
    method: "GET",
    path: "/polls",
    scopes: ["channel:read:polls", "channel:manage:polls"],
    role: "broadcaster",
    inputs: [channel, { id: "pollId", key: "id", optional: true }, first(20), after],
    outputs: [{ id: "cursor", path: "pagination.cursor", kind: "string", optional: true }],
  },
];

const rewardFields: ReadonlyArray<Input> = [
  { id: "title", min: 1, max: 45 },
  { id: "cost", kind: "int", min: 1 },
  { id: "prompt", max: 200 },
  { id: "background_color" },
  ...[
    "is_enabled",
    "is_user_input_required",
    "is_max_per_stream_enabled",
    "is_max_per_user_per_stream_enabled",
    "is_global_cooldown_enabled",
    "is_paused",
    "should_redemptions_skip_request_queue",
  ].map((id): Input => ({ id, kind: "bool" })),
  ...["max_per_stream", "max_per_user_per_stream", "global_cooldown_seconds"].map(
    (id): Input => ({ id, kind: "int", min: 1 }),
  ),
];
const validateInput = Effect.fnUntraced(function* (field: Input, value: Schema.Json) {
  const kind = field.kind ?? "string";
  if (
    kind === "int"
      ? typeof value !== "number" || !Number.isSafeInteger(value)
      : kind === "bool"
        ? typeof value !== "boolean"
        : typeof value !== "string"
  )
    return yield* new HelixError({
      reason: `${field.id} must be ${kind === "json" ? "a JSON string" : kind}`,
    });
  const size =
    typeof value === "string" ? value.length : typeof value === "number" ? value : undefined;
  if (
    size !== undefined &&
    ((field.min !== undefined && size < field.min) || (field.max !== undefined && size > field.max))
  )
    return yield* new HelixError({ reason: `${field.id} is outside the allowed range` });
  if (field.values && !field.values.some((allowed) => allowed === value))
    return yield* new HelixError({ reason: `Invalid ${field.id}` });
  if ((field.key?.endsWith("_id") || field.id.endsWith("Id")) && value === "")
    return yield* new HelixError({ reason: `${field.id} must not be empty` });
});
export const prepare = Effect.fnUntraced(function* (
  id: string,
  inputs: Readonly<Record<string, Schema.Json>>,
  accountId: string,
) {
  const action = actions.find((action) => action.id === id);
  if (!action) return yield* new HelixError({ reason: "Unknown Twitch action" });
  for (const key of Object.keys(inputs))
    if (!action.inputs.some((field) => field.id === key))
      return yield* new HelixError({ reason: `Unknown input: ${key}` });
  const query: Record<string, string> = {};
  const body: Record<string, Schema.Json> = {};
  const data: Record<string, Schema.Json> = {};
  for (const field of action.inputs) {
    const value = inputs[field.id];
    if (value === undefined) {
      if (!field.optional) return yield* new HelixError({ reason: `${field.id} is required` });
      continue;
    }
    yield* validateInput(field, value);
    const key = field.key ?? field.id;
    switch (field.location ?? "query") {
      case "query":
        query[key] = String(value);
        break;
      case "body":
        body[key] = value;
        break;
      case "data":
        data[key] = value;
        break;
    }
  }
  if (Object.keys(data).length) body.data = data;
  if (action.role === "moderator") query.moderator_id = accountId;
  if (action.role === "sender") query.from_user_id = accountId;
  const rewardJson = inputs.optionsJson ?? inputs.changesJson;
  if (typeof rewardJson === "string") {
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(rewardJson),
      catch: (error) =>
        new HelixError({
          reason: error instanceof Error ? error.message : "Invalid Twitch inputs",
        }),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Json))),
      Effect.catchTag("SchemaError", (error) => new HelixError({ reason: error.message })),
    );
    if (id === "EditCustomReward" && !Object.keys(parsed).length)
      return yield* new HelixError({ reason: "Select at least one reward field to update" });
    for (const [key, value] of Object.entries(parsed)) {
      const field = rewardFields.find((field) => field.id === key);
      if (!field || (id === "CreateCustomReward" && ["title", "cost", "is_paused"].includes(key)))
        return yield* new HelixError({ reason: `Unsupported reward field: ${key}` });
      yield* validateInput(field, value);
      if (
        key === "background_color" &&
        (typeof value !== "string" || !/^#[\da-fA-F]{6}$/.test(value))
      )
        return yield* new HelixError({ reason: "background_color must be #RRGGBB" });
      body[key] = value;
    }
    for (const [flag, limit] of [
      ["is_max_per_stream_enabled", "max_per_stream"],
      ["is_max_per_user_per_stream_enabled", "max_per_user_per_stream"],
      ["is_global_cooldown_enabled", "global_cooldown_seconds"],
    ] as const)
      if (id === "CreateCustomReward" && body[flag] === true && body[limit] === undefined)
        return yield* new HelixError({ reason: `${limit} is required when ${flag} is true` });
  }
  if (id === "ModerationChatDelay" && inputs.enabled === false)
    delete body.non_moderator_chat_delay_duration;
  return {
    action,
    query,
    body: Object.keys(body).length ? body : undefined,
    subject: action.role === "broadcaster" ? inputs.broadcasterId : undefined,
  };
});

const get = (value: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        typeof current === "object" && current !== null
          ? Object.fromEntries(Object.entries(current))[key]
          : undefined,
      value,
    );
export const mapResponse = Effect.fnUntraced(function* (
  id: string,
  inputs: Readonly<Record<string, Schema.Json>>,
  response: Schema.Json,
) {
  const action = actions.find((action) => action.id === id);
  if (!action) return yield* new HelixError({ reason: "Unknown Twitch action" });
  if (
    id === "ValidateToken" &&
    !Schema.is(
      Schema.Struct({
        client_id: Schema.String,
        scopes: Schema.Array(Schema.String),
        login: Schema.String,
        user_id: Schema.String,
        expires_in: Schema.Int,
      }),
    )(response)
  )
    return yield* new HelixError({
      reason: "Twitch returned an invalid token validation response",
    });
  const data = get(response, "data");
  if (action.noContent ? response !== null : id !== "ValidateToken" && !Array.isArray(data))
    return yield* new HelixError({ reason: "Twitch returned an invalid action response" });
  if (
    Array.isArray(data) &&
    !data.every(
      (item: unknown) => typeof item === "object" && item !== null && !Array.isArray(item),
    )
  )
    return yield* new HelixError({ reason: "Twitch returned invalid data entries" });
  if (
    id.startsWith("CheckUser") &&
    Array.isArray(data) &&
    (data.length > 1 || data.some((item: unknown) => get(item, "user_id") !== inputs.userId))
  )
    return yield* new HelixError({ reason: "Twitch returned an invalid user lookup" });
  const match: unknown =
    id === "GetRewardByTitle" && Array.isArray(data)
      ? data.find((item: unknown) => get(item, "title") === inputs.title)
      : undefined;
  const outputs: Record<string, Schema.Json> = {};
  for (const field of action.outputs ?? []) {
    const value = field.path === "match" ? match : get(response, field.path);
    if (field.kind === "exists") {
      outputs[field.id] = value !== undefined && value !== null;
      continue;
    }
    if (
      value === undefined &&
      field.path.startsWith("data.0.") &&
      Array.isArray(data) &&
      data.length > 0
    )
      return yield* new HelixError({ reason: `Twitch omitted ${field.id}` });
    if (
      field.optional &&
      (value === undefined || value === null || (field.id === "color" && value === ""))
    ) {
      outputs[field.id] = null;
      continue;
    }
    if (field.kind === "json") {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        return yield* new HelixError({ reason: `Twitch returned invalid ${field.id}` });
    }
    if (!Schema.is(Schema.Json)(value))
      return yield* new HelixError({ reason: `Twitch returned invalid ${field.id}` });
    if (field.kind !== "json") yield* validateInput({ id: field.id, kind: field.kind }, value);
    outputs[field.id] = value;
  }
  return outputs;
});
