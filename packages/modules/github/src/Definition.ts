import { Engine, Resource, SafeObjectKey } from "@macrograph/module";
import { Array, Effect, Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const AccountId = SafeObjectKey.pipe(Schema.brand("GitHubAccountId"));
export type AccountId = typeof AccountId.Type;
export const WebhookId = SafeObjectKey.pipe(Schema.brand("GitHubWebhookId"));
export type WebhookId = typeof WebhookId.Type;

export class GitHubAccount extends Resource.make<GitHubAccount, AccountId>()("GitHubAccount", {
  name: "GitHub Account",
}) {}
export class GitHubWebhook extends Resource.make<GitHubWebhook, WebhookId>()("GitHubWebhook", {
  name: "GitHub Repository Webhook",
}) {}

export const WebhookEventName = Schema.Literals([
  "push",
  "pull_request",
  "issues",
  "issue_comment",
  "workflow_run",
  "release",
]);
export type WebhookEventName = typeof WebhookEventName.Type;

export const ActionId = Schema.Literals([
  "get-repository",
  "list-branches",
  "list-commits",
  "list-releases",
  "list-contributors",
  "list-issues",
  "get-issue",
  "create-issue",
  "update-issue",
  "list-pull-requests",
  "get-pull-request",
  "create-comment",
]);
export type ActionId = typeof ActionId.Type;

export class GitHubFailure extends Schema.TaggedError<GitHubFailure>()("GitHubFailure", {
  reason: Schema.String,
  status: Schema.optional(Schema.Int),
}) {}

export class WebhookDelivery extends Schema.TaggedClass<WebhookDelivery>()(
  "GitHubWebhookDelivery",
  {
    webhookId: WebhookId,
    event: WebhookEventName,
    action: Schema.String,
    owner: Schema.String,
    repository: Schema.String,
    sender: Schema.String,
    deliveryId: Schema.String,
    payloadJson: Schema.String,
  },
) {}

const RepositoryWebhook = Schema.Struct({
  name: Schema.String,
  accountId: AccountId,
  owner: Schema.String,
  repository: Schema.String,
  events: Schema.Array(WebhookEventName),
  providerHookId: Schema.optional(Schema.Int),
});

export const RuntimeStorage = Schema.Struct({
  webhooks: Schema.Record(WebhookId, RepositoryWebhook).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
});

export const AccountSummary = Schema.Struct({
  id: AccountId,
  displayName: Schema.String,
});
export const WebhookSummary = Schema.Struct({
  id: WebhookId,
  ...RepositoryWebhook.fields,
  endpointUrl: Schema.optional(Schema.String),
});
export const ClientState = Schema.Struct({
  accounts: Schema.Array(AccountSummary),
  webhooks: Schema.Array(WebhookSummary),
  provisioningAvailable: Schema.Boolean,
});

export class RuntimeRpcs extends RpcGroup.make(
  Rpc.make("GitHubRequest", {
    payload: Schema.Struct({
      accountId: AccountId,
      action: ActionId,
      inputs: Schema.Record(Schema.String, Schema.Json),
    }),
    success: Schema.Struct({ status: Schema.Int, body: Schema.Json }),
    error: GitHubFailure,
  }),
) {}

export class ClientRpcs extends RpcGroup.make(
  Rpc.make("GitHubCreateWebhook", {
    payload: Schema.Struct({
      name: Schema.String,
      accountId: AccountId,
      owner: Schema.String,
      repository: Schema.String,
      events: Schema.Array(WebhookEventName),
    }),
    success: WebhookId,
    error: GitHubFailure,
  }),
  Rpc.make("GitHubUpdateWebhook", {
    payload: Schema.Struct({
      webhookId: WebhookId,
      name: Schema.String,
      events: Schema.Array(WebhookEventName),
    }),
    error: GitHubFailure,
  }),
  Rpc.make("GitHubRemoveWebhook", {
    payload: Schema.Struct({ webhookId: WebhookId }),
    error: GitHubFailure,
  }),
) {}

export class GitHubEngine extends Engine.make({
  resources: [GitHubAccount, GitHubWebhook],
  events: Array.empty<WebhookDelivery>(),
  storage: RuntimeStorage,
  initialStorage: { webhooks: {} },
  rpcs: RuntimeRpcs,
  client: { state: ClientState, rpcs: ClientRpcs },
}) {}
