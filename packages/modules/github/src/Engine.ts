import { HttpEndpoint } from "@macrograph/module";
import { Context, Effect, Layer, Option, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";

import { makeApi, prepare, type PreparedRequest } from "./Api.ts";
import {
  AccountId,
  ClientRpcs,
  ClientState,
  GitHubAccount,
  GitHubEngine,
  GitHubFailure,
  GitHubWebhook,
  RuntimeRpcs,
  type WebhookEventName,
  WebhookId,
} from "./Definition.ts";
import { WebhookIngress } from "./Webhook.ts";

export interface WebhookEndpoint {
  readonly url: string;
  readonly secret: Redacted.Redacted<string>;
}

export class WebhookEndpoints extends Context.Service<
  WebhookEndpoints,
  {
    readonly available: boolean;
    readonly resolve: (webhookId: WebhookId) => Effect.Effect<WebhookEndpoint, GitHubFailure>;
  }
>()("@macrograph/module-github/WebhookEndpoints") {}

export const unavailableWebhookEndpoints = Layer.succeed(WebhookEndpoints, {
  available: false,
  resolve: () =>
    Effect.fail(
      new GitHubFailure({
        reason: "Repository webhook provisioning is only available on MacroGraph Cloud",
      }),
    ),
});

export const webhookEndpointsLayer = Layer.effect(WebhookEndpoints)(
  Effect.gen(function* () {
    const endpoints = yield* HttpEndpoint.Host;
    return WebhookEndpoints.of({
      available: true,
      resolve: (webhookId) =>
        endpoints.get(WebhookIngress, webhookId).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () =>
                Effect.fail(
                  new GitHubFailure({
                    reason: "The GitHub webhook endpoint has not been reconciled",
                  }),
                ),
              onSome: (endpoint) =>
                endpoints.secret(endpoint.id).pipe(
                  Effect.map((secret) => ({ url: endpoint.url, secret })),
                  Effect.mapError(
                    () =>
                      new GitHubFailure({
                        reason: "The GitHub webhook signing secret is unavailable",
                      }),
                  ),
                ),
            }),
          ),
          Effect.mapError((error) =>
            error instanceof GitHubFailure
              ? error
              : new GitHubFailure({ reason: "The GitHub webhook endpoint is unavailable" }),
          ),
        ),
    });
  }),
);

const validOwner = /^[A-Za-z\d](?:[A-Za-z\d-]{0,37}[A-Za-z\d])?$/;
const validRepository = /^[A-Za-z\d._-]{1,100}$/;
const validateRepository = (owner: string, repository: string) =>
  validOwner.test(owner) && validRepository.test(repository)
    ? Effect.void
    : Effect.fail(new GitHubFailure({ reason: "Enter a valid GitHub owner and repository name" }));

const normalizeEvents = (events: ReadonlyArray<WebhookEventName>) => [...new Set(events)];

export const layer = GitHubEngine.toLayer((mg) =>
  Effect.gen(function* () {
    const webhookEndpoints = yield* WebhookEndpoints;
    const getCredential = (accountId: AccountId, refresh: boolean) =>
      (refresh
        ? mg.credentials.refresh("github", accountId).pipe(Effect.map((value) => [value]))
        : mg.credentials.get
      ).pipe(
        Effect.flatMap((credentials) => {
          const credential = credentials.find(
            (candidate) => candidate.provider === "github" && candidate.id === accountId,
          );
          return credential === undefined
            ? Effect.fail(
                new GitHubFailure({ reason: "The selected GitHub credential is unavailable" }),
              )
            : Effect.succeed({ token: credential.token.access });
        }),
      );
    const api = yield* makeApi(getCredential);
    const raw = (accountId: AccountId, request: PreparedRequest) => api.execute(accountId, request);

    yield* mg.credentials.subscribe(() =>
      Effect.all([mg.resource.refresh(GitHubAccount), mg.client.refresh], { discard: true }),
    );

    return GitHubEngine.of({
      resources: Layer.mergeAll(
        GitHubAccount.toLayer(
          mg.credentials.get.pipe(
            Effect.map((credentials) =>
              credentials
                .filter((credential) => credential.provider === "github")
                .map((credential) => ({
                  id: AccountId.make(credential.id),
                  display: credential.displayName ?? credential.id,
                })),
            ),
          ),
        ),
        GitHubWebhook.toLayer(
          mg.storage.get.pipe(
            Effect.map((storage) =>
              Object.entries(storage.webhooks).map(([id, webhook]) => ({
                id: WebhookId.make(id),
                display: webhook.name,
              })),
            ),
          ),
        ),
      ),
      rpcs: RuntimeRpcs.toLayer({
        GitHubRequest: ({ accountId, action, inputs }) =>
          Effect.try({
            try: () => prepare(action, inputs),
            catch: (error) =>
              error instanceof GitHubFailure ? error : new GitHubFailure({ reason: String(error) }),
          }).pipe(Effect.flatMap((request) => raw(accountId, request))),
      }),
      client: {
        state: Effect.gen(function* () {
          const [credentials, storage] = yield* Effect.all([mg.credentials.get, mg.storage.get]);
          const webhooks = yield* Effect.forEach(
            Object.entries(storage.webhooks),
            ([id, webhook]) => {
              const webhookId = WebhookId.make(id);
              return webhookEndpoints.available
                ? webhookEndpoints.resolve(webhookId).pipe(
                    Effect.map((endpoint) => ({
                      id: webhookId,
                      ...webhook,
                      endpointUrl: endpoint.url,
                    })),
                    Effect.catch(() => Effect.succeed({ id: webhookId, ...webhook })),
                  )
                : Effect.succeed({ id: webhookId, ...webhook });
            },
          );
          return ClientState.make({
            accounts: credentials
              .filter((credential) => credential.provider === "github")
              .map((credential) => ({
                id: AccountId.make(credential.id),
                displayName: credential.displayName ?? credential.id,
              })),
            webhooks,
            provisioningAvailable: webhookEndpoints.available,
          });
        }),
        rpcs: ClientRpcs.toLayer({
          GitHubListInstallations: ({ accountId }) => api.listInstallations(accountId),
          GitHubListRepositories: ({ accountId, installationId }) =>
            api.listRepositories(accountId, installationId),
          GitHubCreateWebhook: (input) =>
            Effect.gen(function* () {
              if (!webhookEndpoints.available)
                return yield* new GitHubFailure({
                  reason: "Repository webhook provisioning is only available on MacroGraph Cloud",
                });
              yield* validateRepository(input.owner, input.repository);
              const events = normalizeEvents(input.events);
              if (events.length === 0)
                return yield* new GitHubFailure({ reason: "Select at least one webhook event" });
              const repositories = yield* api.listRepositories(
                input.accountId,
                input.installationId,
              );
              const selected = repositories.find(
                (repository) => repository.id === input.repositoryId,
              );
              if (
                selected === undefined ||
                selected.owner !== input.owner ||
                selected.name !== input.repository
              )
                return yield* new GitHubFailure({
                  reason: "The selected repository is not available to this GitHub installation",
                });
              const webhookId = WebhookId.make(crypto.randomUUID());
              const value = {
                ...input,
                name: input.name.trim() || `${input.owner}/${input.repository}`,
                events,
              };
              yield* mg.storage.update((storage) => ({
                webhooks: { ...storage.webhooks, [webhookId]: value },
              }));
              yield* Effect.all([mg.resource.refresh(GitHubWebhook), mg.client.refresh], {
                discard: true,
              });
              return webhookId;
            }),
          GitHubUpdateWebhook: ({ webhookId, name, events: requestedEvents }) =>
            Effect.gen(function* () {
              const storage = yield* mg.storage.get;
              const current = storage.webhooks[webhookId];
              if (current === undefined)
                return yield* new GitHubFailure({ reason: "GitHub webhook not found" });
              const events = normalizeEvents(requestedEvents);
              if (events.length === 0)
                return yield* new GitHubFailure({ reason: "Select at least one webhook event" });
              const next = { ...current, name: name.trim() || current.name, events };
              yield* mg.storage.update((value) => ({
                webhooks: { ...value.webhooks, [webhookId]: next },
              }));
              yield* Effect.all([mg.resource.refresh(GitHubWebhook), mg.client.refresh], {
                discard: true,
              });
            }),
          GitHubRemoveWebhook: ({ webhookId }) =>
            Effect.gen(function* () {
              const storage = yield* mg.storage.get;
              const current = storage.webhooks[webhookId];
              if (current === undefined) return;
              yield* mg.storage.update((value) => {
                const webhooks = { ...value.webhooks };
                delete webhooks[webhookId];
                return { webhooks };
              });
              yield* Effect.all([mg.resource.refresh(GitHubWebhook), mg.client.refresh], {
                discard: true,
              });
            }),
        }),
      },
    });
  }),
);

export default layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(unavailableWebhookEndpoints),
);

export const unavailableRuntimeClient = {
  GitHubRequest: () =>
    Effect.fail(
      new GitHubFailure({
        reason:
          "GitHub REST requests are unavailable in Cloud workflow execution because OAuth credentials are session-scoped",
      }),
    ),
};
