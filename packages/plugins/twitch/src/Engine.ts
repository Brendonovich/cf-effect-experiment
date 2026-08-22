import { Cache, HashMap, Layer, Option } from "effect";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";
import { HttpClientError } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";

import type { Make as MakeEventSub } from "./EventSubImplementation.ts";

import {
  AccountId,
  ClientRpcs,
  ClientState,
  MissingCredential,
  RuntimeRpcs,
  TwitchAccount,
  TwitchEngine,
  TwitchEventSub,
} from "./Definition.ts";
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

      const helixClients = yield* Cache.make({
        timeToLive: "5 minutes",
        requireServicesAt: "construction",
        capacity: Number.MAX_SAFE_INTEGER,
        lookup: Effect.fnUntraced(function* (accountId: AccountId) {
          const credential = yield* getCredential(accountId);
          if (Option.isNone(credential)) return yield* new MissingCredential();

          return yield* Helix.makeClient(
            credential.value.token.access,
            mg.credentials
              .refresh("twitch", accountId)
              .pipe(Effect.map((refreshed) => refreshed.token.access)),
          );
        }),
      });

      const eventSub = yield* makeEventSub({
        getAccountIds: mg.storage.get.pipe(
          Effect.map((storage) => Object.keys(storage.accounts).map((id) => AccountId.make(id))),
        ),
        getHelix: (accountId) => helixClients.lookup(accountId),
        getSubscriptions: (accountId) =>
          mg.storage.get.pipe(
            Effect.map((storage) => storage.accounts[accountId]?.subscriptions ?? []),
          ),
        emit: mg.emit,
        refresh: mg.client.refresh,
      });

      const connect = (accountId: AccountId) =>
        eventSub.connect(accountId).pipe(
          Effect.catch((error) =>
            Effect.logError("Failed to connect Twitch EventSub", error, { accountId }),
          ),
          Effect.ignore,
        );
      const scope = yield* Effect.scope;

      yield* mg.credentials.subscribe((credential) =>
        Effect.all(
          [
            mg.resource.refresh(TwitchAccount),
            Cache.invalidateAll(helixClients),
            credential.provider === "twitch"
              ? mg.storage.get.pipe(
                  Effect.flatMap((storage) => {
                    const accountId = AccountId.make(credential.id);
                    return storage.accounts[accountId] === undefined
                      ? Effect.void
                      : connect(accountId).pipe(Effect.forkIn(scope), Effect.asVoid);
                  }),
                )
              : Effect.void,
          ],
          { discard: true },
        ),
      );

      yield* mg.storage.get.pipe(
        Effect.flatMap((storage) =>
          Effect.forEach(
            Object.keys(storage.accounts),
            (accountId) => connect(AccountId.make(accountId)),
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
                    HashMap.get(eventSubState, id).pipe(Option.getOrUndefined)?.state ??
                    "disconnected",
                },
                enabledSubscriptions: storage.accounts[id]?.subscriptions ?? [],
              };
            }),
        });
      });

      const helixRpc = <A, RX>(
        accountId: AccountId,
        callback: (
          helix: HttpApiClient.ForApi<typeof Helix.Api.HelixApi>,
        ) => Effect.Effect<A, HttpClientError.HttpClientError | S.SchemaError, RX>,
      ) =>
        Effect.gen(function* () {
          const helix = yield* helixClients.lookup(accountId);
          return yield* callback(helix).pipe(
            Effect.catchTag("HttpClientError", Helix.fromHttpClientError),
            Effect.catchTag(
              "SchemaError",
              (cause) => new Helix.HelixError({ reason: String(cause) }),
            ),
          );
        });

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
            eventSub.state.pipe(
              Effect.map((accounts) =>
                [...accounts].map(([id]) => ({
                  id,
                  display: id,
                })),
              ),
            ),
          ),
        ),
        rpcs: RuntimeRpcs.toLayer({
          SendChatMessage: (payload) =>
            helixRpc(payload.account_id, (helix) => helix.chat.sendMessage()),
        }),
        client: {
          state: clientState,
          rpcs: ClientRpcs.toLayer({
            ConnectEventSub: ({ accountId }) =>
              Effect.gen(function* () {
                yield* Effect.logInfo("EventSub connect RPC received");
                yield* eventSub.connect(accountId).pipe(
                  Effect.tap(() => Effect.logInfo("EventSub connect RPC completed")),
                  Effect.tapError((error) => Effect.logError("EventSub connect RPC failed", error)),
                );
              }).pipe(Effect.annotateLogs({ accountId, eventSubTransport: eventSub.transport })),
            DisconnectEventSub: ({ accountId }) =>
              Effect.gen(function* () {
                yield* Effect.logInfo("EventSub disconnect RPC received");
                yield* eventSub.disconnect(accountId);
                yield* Effect.logInfo("EventSub disconnect RPC completed");
              }).pipe(Effect.annotateLogs({ accountId, eventSubTransport: eventSub.transport })),
            ToggleEventSubSubscription: Effect.fnUntraced(function* ({
              accountId,
              subscriptionType,
              enabled,
            }) {
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
                    [accountId]: { subscriptions },
                  },
                };
              });
              yield* eventSub.connect(accountId).pipe(
                Effect.catch((error) =>
                  Effect.log("Failed to reconcile EventSub subscriptions", error),
                ),
                Effect.ignore,
              );
            }),
          }),
        },
      };
    }),
  );
