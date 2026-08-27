import { Cache, Exit, HashMap, Layer, Option, Redacted } from "effect";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";

import type { Make as MakeEventSub } from "./EventSubImplementation.ts";

import {
  AccountId,
  ClientRpcs,
  ClientState,
  CredentialAuthorizationError,
  MissingCredential,
  RuntimeRpcs,
  TwitchAccount,
  TwitchEngine,
  TwitchEventSub,
  TwitchExecutionUnavailable,
} from "./Definition.ts";
import { SUBSCRIPTION_TYPES } from "./EventSub.ts";
import { Helix } from "./Helix.ts";

export const make = <R>(makeEventSub: MakeEventSub<R>) =>
  TwitchEngine.toLayer((mg) =>
    Effect.gen(function* () {
      const getCredential = (accountId: AccountId) =>
        mg.credentials.get.pipe(
          Effect.map((credentials) =>
            credentials.find(
              (credential) => credential.provider === "twitch" && credential.id === accountId,
            ),
          ),
          Effect.map(Option.fromNullishOr),
        );

      const helixClients = yield* Cache.makeWith(
        Effect.fnUntraced(function* (accountId: AccountId) {
          const credential = yield* getCredential(accountId);
          if (Option.isNone(credential))
            return yield* new MissingCredential({
              accountId,
              reason:
                "Select a connected Twitch account and authorize the scopes required by this operation",
            });

          return yield* Helix.makeClient(
            Redacted.value(credential.value.token.access),
            mg.credentials
              .refresh("twitch", accountId)
              .pipe(Effect.map((refreshed) => Redacted.value(refreshed.token.access))),
            credential.value.clientId ?? Helix.DEFAULT_CLIENT_ID,
          );
        }),
        {
          timeToLive: (exit) => (Exit.isSuccess(exit) ? "5 minutes" : 0),
          requireServicesAt: "construction",
          capacity: Number.MAX_SAFE_INTEGER,
        },
      );

      const httpClient = yield* HttpClient.HttpClient;
      const TokenValidation = S.Struct({
        client_id: S.String,
        user_id: S.String,
        scopes: S.Array(S.String),
      });
      const refreshingAccounts = new Set<AccountId>();
      const authorizations = yield* Cache.makeWith(
        Effect.fnUntraced(function* (accountId: AccountId) {
          const credential = yield* getCredential(accountId);
          if (Option.isNone(credential))
            return yield* new MissingCredential({
              accountId,
              reason:
                "Select a connected Twitch account and authorize the scopes required by this operation",
            });
          const validate = (token: string) =>
            HttpClientRequest.get("https://id.twitch.tv/oauth2/validate").pipe(
              HttpClientRequest.bearerToken(token),
              HttpClient.filterStatusOk(httpClient).execute,
              Effect.flatMap(HttpClientResponse.schemaBodyJson(TokenValidation)),
              // Keep local spans without adding headers that Twitch's CORS policy rejects.
              Effect.provideService(HttpClient.TracerPropagationEnabled, false),
            );
          const validation = yield* validate(Redacted.value(credential.value.token.access)).pipe(
            Effect.catchTag("HttpClientError", (error) =>
              error.response?.status === 401
                ? Effect.acquireUseRelease(
                    Effect.sync(() => refreshingAccounts.add(accountId)),
                    () => mg.credentials.refresh("twitch", accountId),
                    () => Effect.sync(() => refreshingAccounts.delete(accountId)),
                  ).pipe(
                    Effect.tap(() => Cache.invalidate(helixClients, accountId)),
                    Effect.flatMap((refreshed) => validate(Redacted.value(refreshed.token.access))),
                  )
                : Effect.fail(error),
            ),
            Effect.map(Option.some),
            Effect.catchTag("HttpClientError", (error) =>
              // Cache unavailable validation too, so CORS failures do not precede every action.
              error.reason._tag === "TransportError" ||
              (error.response !== undefined &&
                error.response.status >= 500 &&
                error.response.status < 600)
                ? Effect.succeed(Option.none())
                : Helix.fromHttpClientError(error),
            ),
            Effect.catchTag(
              "SchemaError",
              () =>
                new Helix.HelixError({
                  reason: "Twitch returned an invalid credential validation response",
                }),
            ),
          );
          if (Option.isNone(validation)) return Option.none<Set<string>>();
          if (validation.value.user_id !== accountId)
            return yield* new CredentialAuthorizationError({
              accountId,
              reason: "The selected credential belongs to a different Twitch user",
              requiredScopes: [],
            });
          if (validation.value.client_id !== (credential.value.clientId ?? Helix.DEFAULT_CLIENT_ID))
            return yield* new CredentialAuthorizationError({
              accountId,
              reason: "The selected credential was issued to a different Twitch application",
              requiredScopes: [],
            });
          return Option.some(new Set(validation.value.scopes));
        }),
        {
          timeToLive: (exit) => (Exit.isSuccess(exit) ? "5 minutes" : 0),
          requireServicesAt: "construction",
          capacity: Number.MAX_SAFE_INTEGER,
        },
      );

      const eventSub = yield* makeEventSub({
        getAccountIds: mg.storage.get.pipe(
          Effect.map((storage) =>
            Object.entries(storage.accounts).flatMap(([id, account]) =>
              account.enabled ? [AccountId.make(id)] : [],
            ),
          ),
        ),
        getHelix: (accountId) => Cache.get(helixClients, accountId),
        getSubscriptions: (accountId) =>
          mg.storage.get.pipe(
            Effect.map((storage) => {
              const account = storage.accounts[accountId];
              return account?.enabled ? account.subscriptions : [];
            }),
          ),
        emit: mg.emit,
        refresh: Effect.all([mg.client.refresh, mg.resource.refresh(TwitchEventSub)], {
          discard: true,
        }),
      });
      const scope = yield* Effect.scope;

      const connectEventSub = (accountId: AccountId) =>
        Cache.get(authorizations, accountId).pipe(Effect.andThen(eventSub.connect(accountId)));
      const connect = (accountId: AccountId) =>
        connectEventSub(accountId).pipe(
          Effect.catch(() => Effect.logWarning("Failed to connect Twitch EventSub", { accountId })),
          Effect.ignore,
        );
      yield* mg.credentials.subscribe(() =>
        Effect.gen(function* () {
          yield* mg.resource.refresh(TwitchAccount);
          yield* mg.client.refresh;
          yield* Cache.invalidateAll(helixClients);
          // A refresh inside validation must not evict itself or start another validation cycle.
          const refreshing = new Set(refreshingAccounts);
          yield* Effect.forEach(
            yield* Cache.keys(authorizations),
            (accountId) =>
              refreshing.has(accountId) ? Effect.void : Cache.invalidate(authorizations, accountId),
            { discard: true },
          );
          const storage = yield* mg.storage.get;
          yield* Effect.forEach(
            Object.entries(storage.accounts),
            ([id, account]) => {
              const accountId = AccountId.make(id);
              return account.enabled && !refreshing.has(accountId)
                ? eventSub.disconnect(accountId).pipe(
                    Effect.andThen(connect(accountId)),
                    Effect.catch((error) =>
                      Effect.logWarning("Failed to reconnect Twitch EventSub", { accountId, error }),
                    ),
                  )
                : Effect.void;
            },
            { discard: true },
          ).pipe(Effect.forkIn(scope));
        }),
      );

      yield* mg.storage.get.pipe(
        Effect.flatMap((storage) =>
          Effect.forEach(
            Object.entries(storage.accounts),
            ([accountId, account]) =>
              account.enabled ? connect(AccountId.make(accountId)) : Effect.void,
            { discard: true },
          ),
        ),
        Effect.forkScoped,
      );

      const clientState = Effect.gen(function* () {
        const credentials = yield* mg.credentials.get;
        const eventSubState = yield* eventSub.state;
        const storage = yield* mg.storage.get;

        return ClientState.make({
          transport: eventSub.transport,
          accounts: credentials
            .filter((credential) => credential.provider === "twitch")
            .map((credential) => {
              const id = AccountId.make(credential.id);
              return {
                id,
                displayName: credential.displayName ?? credential.id,
                eventSubSocket: {
                  state:
                    storage.accounts[id]?.enabled === true
                      ? (HashMap.get(eventSubState, id).pipe(Option.getOrUndefined)?.state ??
                        "disconnected")
                      : "disconnected",
                },
                enabledSubscriptions: storage.accounts[id]?.subscriptions ?? [],
              };
            }),
        });
      });

      const helixRpc = <A, RX>(
        accountId: AccountId,
        requiredScopes: ReadonlyArray<string>,
        callback: (
          helix: HttpApiClient.ForApi<typeof Helix.Api.HelixApi>,
        ) => Effect.Effect<A, HttpClientError.HttpClientError | S.SchemaError, RX>,
      ) =>
        Effect.gen(function* () {
          const grantedScopes = yield* Cache.get(authorizations, accountId);
          if (Option.isSome(grantedScopes)) {
            const missingScopes = requiredScopes.filter((scope) => !grantedScopes.value.has(scope));
            if (missingScopes.length > 0)
              return yield* new CredentialAuthorizationError({
                accountId,
                reason: `Reconnect the selected Twitch account and grant: ${missingScopes.join(", ")}`,
                requiredScopes: missingScopes,
              });
          }
          const helix = yield* Cache.get(helixClients, accountId);
          return yield* callback(helix).pipe(
            Effect.catchTag("HttpClientError", Helix.fromHttpClientError),
            Effect.catchTag(
              "SchemaError",
              (cause) => new Helix.HelixError({ reason: String(cause) }),
            ),
          );
        });

      const requireSubject = (accountId: AccountId, subjectId: string, role: string) =>
        accountId === subjectId
          ? Effect.void
          : Effect.fail(
              new CredentialAuthorizationError({
                accountId,
                reason: `The selected credential must belong to the ${role}`,
                requiredScopes: [],
              }),
            );

      return {
        resources: Layer.mergeAll(
          TwitchAccount.toLayer(
            Effect.map(mg.credentials.get, (credentials) =>
              credentials
                .filter((credential) => credential.provider === "twitch")
                .map((credential) => ({
                  id: AccountId.make(credential.id),
                  display: credential.displayName ?? credential.id,
                })),
            ),
          ),
          TwitchEventSub.toLayer(
            Effect.all([eventSub.state, mg.credentials.get]).pipe(
              Effect.map(([accounts, credentials]) =>
                [...accounts].flatMap(([id, account]) => {
                  if (account.state !== "connected") return [];
                  const credential = credentials.find(
                    (candidate) => candidate.provider === "twitch" && candidate.id === id,
                  );
                  return [{ id, display: credential?.displayName ?? id }];
                }),
              ),
            ),
          ),
        ),
        rpcs: RuntimeRpcs.toLayer({
          SendChatMessage: (payload) =>
            requireSubject(payload.account_id, payload.sender_id, "chat sender").pipe(
              Effect.andThen(
                helixRpc(payload.account_id, ["user:write:chat"], (helix) =>
                  helix.chat.sendMessage({
                    payload: {
                      broadcaster_id: payload.broadcaster_id,
                      sender_id: payload.sender_id,
                      message: payload.message,
                      ...(payload.reply_parent_message_id === undefined
                        ? {}
                        : { reply_parent_message_id: payload.reply_parent_message_id }),
                    },
                  }),
                ),
              ),
            ),
          GetChatSettings: (payload) =>
            helixRpc(payload.account_id, [], (helix) =>
              helix.chat.getSettings({ query: { broadcaster_id: payload.broadcaster_id } }),
            ),
          UpdateChatSettings: (payload) =>
            requireSubject(payload.account_id, payload.moderator_id, "moderator").pipe(
              Effect.andThen(
                helixRpc(payload.account_id, ["moderator:manage:chat_settings"], (helix) =>
                  helix.chat.updateSettings({
                    query: {
                      broadcaster_id: payload.broadcaster_id,
                      moderator_id: payload.moderator_id,
                    },
                    payload: {
                      ...(payload.emote_mode === undefined
                        ? {}
                        : { emote_mode: payload.emote_mode }),
                      ...(payload.follower_mode === undefined
                        ? {}
                        : { follower_mode: payload.follower_mode }),
                      ...(payload.slow_mode === undefined ? {} : { slow_mode: payload.slow_mode }),
                      ...(payload.subscriber_mode === undefined
                        ? {}
                        : { subscriber_mode: payload.subscriber_mode }),
                    },
                  }),
                ),
              ),
            ),
          GetChannelInformation: (payload) =>
            helixRpc(payload.account_id, [], (helix) =>
              helix.channels.getInformation({
                query: { broadcaster_id: payload.broadcaster_id },
              }),
            ),
          ModifyChannelInformation: (payload) =>
            requireSubject(payload.account_id, payload.broadcaster_id, "broadcaster").pipe(
              Effect.andThen(
                helixRpc(payload.account_id, ["channel:manage:broadcast"], (helix) =>
                  helix.channels.modifyInformation({
                    query: { broadcaster_id: payload.broadcaster_id },
                    payload: {
                      ...(payload.game_id === undefined ? {} : { game_id: payload.game_id }),
                      ...(payload.broadcaster_language === undefined
                        ? {}
                        : { broadcaster_language: payload.broadcaster_language }),
                      ...(payload.title === undefined ? {} : { title: payload.title }),
                    },
                  }),
                ),
              ),
            ),
          GetStreams: (payload) =>
            helixRpc(payload.account_id, [], (helix) =>
              helix.streams.getStreams({ query: { user_id: payload.user_id } }),
            ),
          CreateClip: (payload) =>
            helixRpc(payload.account_id, ["clips:edit"], (helix) =>
              helix.clips.createClip({ query: { broadcaster_id: payload.broadcaster_id } }),
            ),
          CreatePoll: (payload) =>
            requireSubject(payload.account_id, payload.broadcaster_id, "broadcaster").pipe(
              Effect.andThen(
                helixRpc(payload.account_id, ["channel:manage:polls"], (helix) =>
                  helix.polls.createPoll({
                    payload: {
                      broadcaster_id: payload.broadcaster_id,
                      title: payload.title,
                      choices: [{ title: payload.choice1 }, { title: payload.choice2 }],
                      duration: payload.duration,
                    },
                  }),
                ),
              ),
            ),
          EndPoll: (payload) =>
            requireSubject(payload.account_id, payload.broadcaster_id, "broadcaster").pipe(
              Effect.andThen(
                helixRpc(payload.account_id, ["channel:manage:polls"], (helix) =>
                  helix.polls.endPoll({
                    payload: {
                      broadcaster_id: payload.broadcaster_id,
                      id: payload.id,
                      status: payload.status,
                    },
                  }),
                ),
              ),
            ),
          CreatePrediction: (payload) =>
            requireSubject(payload.account_id, payload.broadcaster_id, "broadcaster").pipe(
              Effect.andThen(
                helixRpc(payload.account_id, ["channel:manage:predictions"], (helix) =>
                  helix.predictions.createPrediction({
                    payload: {
                      broadcaster_id: payload.broadcaster_id,
                      title: payload.title,
                      outcomes: [{ title: payload.outcome1 }, { title: payload.outcome2 }],
                      prediction_window: payload.prediction_window,
                    },
                  }),
                ),
              ),
            ),
          EndPrediction: (payload) =>
            requireSubject(payload.account_id, payload.broadcaster_id, "broadcaster").pipe(
              Effect.andThen(
                helixRpc(payload.account_id, ["channel:manage:predictions"], (helix) =>
                  helix.predictions.endPrediction({
                    payload: {
                      broadcaster_id: payload.broadcaster_id,
                      id: payload.id,
                      status: payload.status,
                      ...(payload.winning_outcome_id === undefined
                        ? {}
                        : { winning_outcome_id: payload.winning_outcome_id }),
                    },
                  }),
                ),
              ),
            ),
          GetUsers: (payload) =>
            helixRpc(payload.account_id, [], (helix) =>
              helix.users.getUsers({
                query: {
                  ...(payload.id === undefined ? {} : { id: payload.id }),
                  ...(payload.login === undefined ? {} : { login: payload.login }),
                },
              }),
            ),
          GetFollowers: (payload) =>
            helixRpc(payload.account_id, [], (helix) =>
              helix.followers.getFollowers({
                query: { broadcaster_id: payload.broadcaster_id },
              }),
            ),
        }),
        client: {
          state: clientState,
          rpcs: ClientRpcs.toLayer({
            ConnectEventSub: ({ accountId }) =>
              Effect.gen(function* () {
                yield* Effect.logInfo("EventSub connect RPC received");
                const storage = yield* mg.storage.get;
                if (
                  eventSub.transport === "webhook" &&
                  (storage.accounts[accountId]?.subscriptions.length ?? 0) === 0
                )
                  return yield* new Helix.HelixError({
                    reason: "Select at least one EventSub topic before creating a webhook",
                  });
                yield* Cache.get(authorizations, accountId);
                if (storage.accounts[accountId]?.enabled !== true)
                  yield* mg.storage.update((current) => ({
                    accounts: {
                      ...current.accounts,
                      [accountId]: {
                        enabled: true,
                        subscriptions: current.accounts[accountId]?.subscriptions ?? [],
                      },
                    },
                  }));
                yield* eventSub.connect(accountId);
                yield* Effect.logInfo("EventSub connect RPC completed");
              }).pipe(
                Effect.tapError((error) =>
                  Effect.logError("EventSub connect RPC failed", { error }),
                ),
                Effect.annotateLogs({ accountId, eventSubTransport: eventSub.transport }),
              ),
            DisconnectEventSub: ({ accountId }) =>
              Effect.gen(function* () {
                yield* Effect.logInfo("EventSub disconnect RPC received");
                yield* eventSub.disconnect(accountId);
                yield* mg.storage.update((storage) => {
                  const account = storage.accounts[accountId];
                  if (account === undefined) return storage;
                  return {
                    accounts: {
                      ...storage.accounts,
                      [accountId]: { ...account, enabled: false },
                    },
                  };
                });
                yield* Effect.logInfo("EventSub disconnect RPC completed");
              }).pipe(Effect.annotateLogs({ accountId, eventSubTransport: eventSub.transport })),
            ToggleEventSubSubscription: Effect.fnUntraced(function* ({
              accountId,
              subscriptionType,
              enabled,
            }) {
              if (!SUBSCRIPTION_TYPES.some((candidate) => candidate === subscriptionType)) return;
              yield* mg.storage.update((storage) => {
                const current = storage.accounts[accountId]?.subscriptions ?? [];
                const subscriptions = enabled
                  ? current.includes(subscriptionType)
                    ? current
                    : [...current, subscriptionType]
                  : current.filter((subscription) => subscription !== subscriptionType);

                return {
                  accounts: {
                    ...storage.accounts,
                    [accountId]: {
                      enabled: storage.accounts[accountId]?.enabled ?? false,
                      subscriptions,
                    },
                  },
                };
              });
              const storage = yield* mg.storage.get;
              const account = storage.accounts[accountId];
              const eventSubAccount = HashMap.get(yield* eventSub.state, accountId).pipe(
                Option.getOrUndefined,
              );
              if (
                eventSub.transport === "websocket" &&
                account?.enabled === true &&
                eventSubAccount?.state === "connected" &&
                eventSub.reconcile !== undefined
              ) {
                yield* eventSub.reconcile(accountId).pipe(
                  Effect.catch(() => Effect.log("Failed to reconcile EventSub subscriptions")),
                  Effect.ignore,
                );
              }
            }),
          }),
        },
      };
    }),
  );

export const unavailableReason =
  "Twitch actions are unavailable in Cloud workflow execution because OAuth credentials are owned by editor authentication Durable Objects and no credential-scoped workflow RPC binding exists";

const unavailable = (_payload?: unknown) =>
  Effect.fail(new TwitchExecutionUnavailable({ reason: unavailableReason }));

export const unavailableRuntimeClient = {
  SendChatMessage: unavailable,
  GetChatSettings: unavailable,
  UpdateChatSettings: unavailable,
  GetChannelInformation: unavailable,
  ModifyChannelInformation: unavailable,
  GetStreams: unavailable,
  CreateClip: unavailable,
  CreatePoll: unavailable,
  EndPoll: unavailable,
  CreatePrediction: unavailable,
  EndPrediction: unavailable,
  GetUsers: unavailable,
  GetFollowers: unavailable,
};
