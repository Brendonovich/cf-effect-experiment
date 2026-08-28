# Twitch

The catalog contains **92 nodes: 49 unchanged EventSub events and 43 executable actions**. This package adds all 30 missing Electron Helix actions without extending the event catalog. Existing action IDs and pins are preserved; Send Chat Message gains optional `replyId`, and Update Chat Settings gains optional `followerDuration` and `slowDuration`.

## Execution and Authentication

Select a connected **user OAuth account** on each action. Credentials and client IDs remain engine-owned; nodes never accept access tokens. The new `ExecuteAction` RPC accepts only catalog action IDs and their allowlisted inputs, not arbitrary URLs, methods, headers, scopes, or account subjects. It runs through the same authenticated HTTP client and one-time 401 refresh as existing Helix actions. Both standalone WebSocket and webhook deployments use this engine. Cloud workflow execution remains explicitly unavailable until a credential-scoped workflow RPC binding exists.

All new actions expose `responseJson`, a String containing the complete Twitch JSON response. A successful 204 response produces the JSON string `null`. Nested reward, redemption, subscription, Hype Train, poll-choice and chatter data retain Twitch's snake_case names. Optional mapped JSON values are `Option<String>`, not invented empty objects. HTTP failures stop execution with `HelixError`, preserving status, Twitch's message and available rate-limit metadata. Success continues via `exec`. Whispers are a documented exception: Twitch may silently drop them while returning 204.

The engine checks token identity/client and granted scopes using its existing five-minute authorization cache. Validation transport/5xx failures remain best-effort for Helix actions, leaving Twitch to enforce authorization. **Validate Token itself always makes a fresh OAuth validation request** and fails if validation is unavailable. It sends only the Authorization header, never the Helix Client-Id header. It validates the current engine token and may refresh once on 401, rather than diagnosing an arbitrary supplied token. This action does not implement Twitch's required application-wide hourly validation scheduler.

## New Actions

Contracts checked against [Twitch's current API reference](https://dev.twitch.tv/docs/api/reference/) and [token validation documentation](https://dev.twitch.tv/docs/authentication/validate-tokens/) on 2026-08-28. Scope alternatives below mean **OR**, not AND. No scopes or OAuth consent wiring outside this package are changed.

| Node                                     | Method and Path                                        | User Token Scope                                           | Subject / Role                                  |
| ---------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------- |
| Warn User                                | POST `/moderation/warnings`                            | `moderator:manage:warnings`                                | Broadcaster or channel moderator                |
| Ban User                                 | POST `/moderation/bans`                                | `moderator:manage:banned_users`                            | Broadcaster or channel moderator                |
| Unban User                               | DELETE `/moderation/bans`                              | `moderator:manage:banned_users`                            | Broadcaster or channel moderator                |
| Add / Remove Moderator                   | POST / DELETE `/moderation/moderators`                 | `channel:manage:moderators`                                | Broadcaster                                     |
| Add / Remove VIP                         | POST / DELETE `/channels/vips`                         | `channel:manage:vips`                                      | Broadcaster                                     |
| Check User Subscription                  | GET `/subscriptions`                                   | `channel:read:subscriptions`                               | Broadcaster, not the viewer                     |
| Check User Follow                        | GET `/channels/followers`                              | `moderator:read:followers`                                 | Broadcaster or channel moderator                |
| Check User VIP                           | GET `/channels/vips`                                   | `channel:read:vips` or `channel:manage:vips`               | Broadcaster                                     |
| Check User Mod                           | GET `/moderation/moderators`                           | `moderation:read` or `channel:manage:moderators`           | Broadcaster                                     |
| Send Whisper                             | POST `/whispers`                                       | `user:manage:whispers`                                     | Sender, with verified phone number              |
| Get Hype Train                           | GET `/hypetrain/status`                                | `channel:read:hype_train`                                  | Broadcaster                                     |
| Create / Edit / Delete Custom Reward     | POST / PATCH / DELETE `/channel_points/custom_rewards` | `channel:manage:redemptions`                               | Broadcaster, Affiliate or Partner               |
| Update Redemption Status                 | PATCH `/channel_points/custom_rewards/redemptions`     | `channel:manage:redemptions`                               | Broadcaster, reward created by this application |
| Get Reward By Title                      | GET `/channel_points/custom_rewards`                   | `channel:read:redemptions` or `channel:manage:redemptions` | Broadcaster, Affiliate or Partner               |
| Start Commercial                         | POST `/channels/commercial`                            | `channel:edit:commercial`                                  | Broadcaster, live Affiliate or Partner          |
| Get Ad Schedule                          | GET `/channels/ads`                                    | `channel:read:ads`                                         | Broadcaster                                     |
| Snooze Next Ad                           | POST `/channels/ads/schedule/snooze`                   | `channel:manage:ads`                                       | Broadcaster                                     |
| Get Chatters                             | GET `/chat/chatters`                                   | `moderator:read:chatters`                                  | Broadcaster or channel moderator                |
| Get User Chat Color By ID                | GET `/chat/color`                                      | No additional scope                                        | Any selected user account                       |
| Moderation Chat Delay / Unique Chat Mode | PATCH `/chat/settings`                                 | `moderator:manage:chat_settings`                           | Broadcaster or channel moderator                |
| Delete Chat Message                      | DELETE `/moderation/chat`                              | `moderator:manage:chat_messages`                           | Broadcaster or channel moderator                |
| Shoutout User                            | POST `/chat/shoutouts`                                 | `moderator:manage:shoutouts`                               | Broadcaster or channel moderator                |
| Send Announcement                        | POST `/chat/announcements`                             | `moderator:manage:announcements`                           | Broadcaster or channel moderator                |
| Validate Token                           | GET `https://id.twitch.tv/oauth2/validate`             | No additional scope                                        | Selected user account                           |
| Get Polls                                | GET `/polls`                                           | `channel:read:polls` or `channel:manage:polls`             | Broadcaster                                     |

Broadcaster-only actions enforce `broadcasterId === selected account ID` locally. Moderator actions take a target `broadcasterId` and derive `moderator_id` from the selected account; Twitch enforces actual channel moderator membership. Send Whisper derives `from_user_id` from that account. IDs are Twitch IDs, not channel logins. Check User Follow always supplies `user_id`, so Twitch rejects missing scope/role rather than exposing only the public follower total. The existing Get Followers node remains a total-count lookup without this private-data scope requirement.

## Inputs and Constraints

- Warn/Ban bodies use nested `data`; broadcaster/moderator IDs are query parameters. Warning reasons are 1-500 characters. Ban duration is optional: omit it for a permanent ban, or use 1-1209600 seconds for a timeout. Optional ban reason is at most 500 characters. Unban, moderator and VIP operations send query parameters, not JSON bodies. Twitch enforces VIP capacity and moderator/VIP eligibility conflicts.
- Relationship checks return `subscribed`, `following`, `vip` or `moderator` from the filtered data array. Subscription details are `subscriptionJson`; follow timestamp is `followedAt`. No match gives false and None. A malformed or mismatched user result is an error, not false.
- Send Whisper sends `userId` as `to_user_id` in the query and `message` in JSON. Sender and recipient must differ. Twitch limits whispers to 40 unique recipients/day, 3/second, 100/minute; it truncates messages to 500 characters for new conversations or 10000 for established conversations and may silently drop them.
- Get Hype Train uses the current status API, **not the removed `/hypetrain/events` API**. `currentJson` is None when `data[0].current` is null; the full response also retains all-time and shared-train records. No fabricated cooldown/expiry fields from the legacy event format are exposed.
- Create Custom Reward takes `title` (1-45 characters, unique), `cost` (positive safe integer), and optional `optionsJson`. Edit takes `rewardId` and required nonempty `changesJson`. Both JSON inputs must be objects of supported Twitch fields; unknown fields and invalid scalar types fail before HTTP. The broadcaster supports at most 50 custom rewards. Edit/Delete and redemption management require the same application client ID that created the reward; dashboard-created rewards cannot be managed by an unrelated app.
- Supported reward JSON keys: `prompt` (0-200 characters), `background_color` (`#RRGGBB`), `is_enabled`, `is_user_input_required`, `is_max_per_stream_enabled`, `max_per_stream`, `is_max_per_user_per_stream_enabled`, `max_per_user_per_stream`, `is_global_cooldown_enabled`, `global_cooldown_seconds`, and `should_redemptions_skip_request_queue`. Edit additionally accepts `title`, `cost`, `is_paused`. Limits/cooldowns are positive safe integers. When creating an enabled limit/cooldown, supply its corresponding value. Edits may enable an existing saved limit without resending its value. Omissions preserve existing fields; false and empty prompt are forwarded unchanged. A prompt does not implicitly turn on user input. Cooldowns below 60 seconds are not shown in Twitch's UX.
- Update Redemption Status takes one `rewardId`, one `redemptionId`, and `FULFILLED` or `CANCELED`. IDs go in the query; status goes in JSON. Only UNFULFILLED redemptions may transition; reward ownership and redemption state are enforced by Twitch. Output `redemptionJson` includes the unchanged nested reward.
- Get Reward By Title compares titles exactly, case-sensitively, across the returned reward list. `manageableOnly` maps to `only_manageable_rewards`; false can include rewards this client cannot edit. `rewardJson` is None if no title matches.
- Start Commercial accepts 30, 60, 90, 120, 150 or 180 seconds and returns `retryAfter`. Twitch may shorten a break and enforces the live/eligibility rules and eight-minute cooldown. Get Ad Schedule has no duration input; Snooze Next Ad has no duration input and moves the next automatic mid-roll by five minutes if a snooze is available. Both expose all returned schedule fields in `responseJson`.
- Get Chatters takes optional `first` (1-1000) and `after`; Get Polls takes optional `pollId`, `first` (1-20) and `after`. Each makes one page request, retaining `data`, `pagination`, and totals where supplied. Both expose optional `cursor` for the next page. Polls remain available for 90 days. Chatters are chat-connected users, not a reliable viewer count.
- Get User Chat Color By ID exposes `color` as None for an empty color string or no user result. Malformed color fields fail instead of becoming an empty string.
- Moderation Chat Delay takes `enabled` and optional `duration` (2, 4 or 6 seconds). Disabling omits duration. Unique Chat Mode takes `enabled`. Delete Chat Message requires a nonempty `messageId` and never accidentally clears the entire chat; Twitch only allows eligible messages less than six hours old and restricts deletion of broadcaster/moderator messages.
- Shoutout User takes `userId` as the destination broadcaster ID. Twitch requires a live source with viewers, prohibits self-shoutouts and enforces a two-minute global and one-hour same-recipient cooldown. Send Announcement takes `message` (1-500 characters) and optional `color`: `blue`, `green`, `orange`, `purple`, `primary`. Twitch limits announcements to one every two seconds.
- Existing Send Chat Message requires `user:write:chat` with the selected account as sender. Optional `replyId` maps to `reply_parent_message_id`; None or empty string omits the field. A 200 response with `is_sent: false` fails using Twitch's drop reason. Successful responses with `drop_reason: null` are supported.
- Existing Update Chat Settings requires `moderator:manage:chat_settings` and its `moderatorId` must equal the selected account. `followerDuration` is 0-129600 minutes and maps to `follower_mode_duration`; `slowDuration` is 3-120 seconds and maps to **`slow_mode_wait_time`**, not the legacy `slow_mode_duration`. Set the corresponding mode explicitly. Durations are omitted when disabling; omitted durations when enabling use Twitch's defaults.

Example Create Custom Reward `optionsJson`:

```json
{
  "prompt": "Choose a game",
  "is_user_input_required": true,
  "is_enabled": true,
  "is_max_per_stream_enabled": true,
  "max_per_stream": 5,
  "is_global_cooldown_enabled": true,
  "global_cooldown_seconds": 60
}
```

## Deferrals and Verification

No requested action is deferred. EventSub additions, legacy beta endpoints, app-token authorization, login-to-ID resolution, automatic pagination, batch redemption/poll/user queries, OAuth consent scope expansion, app counts/wiring and Cloud workflow credential transport remain outside this change. The engine does not retry 429 responses or schedule rate-limited operations automatically. Twitch remains authoritative for dynamic roles, eligibility, ownership, state and cooldowns.

`test/Actions.test.ts` exercises all 30 nodes through catalog registration, runtime RPCs and a mocked HTTP transport, checking method/path/query/body, account/client headers, JSON and mapped outputs, optional values, scope alternatives, subject mismatches, missing credentials, validation unavailability, 401 refresh, HTTP errors and rate-limit metadata. Existing catalog, authorization, Helix, engine and EventSub tests remain in place. These are deterministic transport tests, not live OAuth/Twitch integration tests.

```sh
pnpm --filter @macrograph/plugin-twitch exec vitest run
pnpm --filter @macrograph/plugin-twitch typecheck
pnpm typecheck
```
