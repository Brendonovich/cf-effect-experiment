import type { HttpEndpoint } from "@macrograph/plugin";
import type * as S from "effect/Schema";
import type * as Scope from "effect/Scope";
import type { HttpClientError } from "effect/unstable/http";
import type { HttpApiClient } from "effect/unstable/httpapi";

import { HashMap } from "effect";
import * as Effect from "effect/Effect";

import type { AccountId, MissingCredential } from "./Definition.ts";

import { EventSubSocket, SUBSCRIPTIONS, SubscriptionEvent } from "./EventSub.ts";
import { Helix } from "./Helix.ts";

export type State = "disconnected" | "connecting" | "connected";

export interface Controller {
  readonly transport: "websocket" | "webhook";
  readonly state: Effect.Effect<HashMap.HashMap<AccountId, { readonly state: State }>>;
  readonly connect: (
    accountId: AccountId,
    options?: { readonly endpoint: HttpEndpoint.Resolved<{ readonly accountId: AccountId }> },
  ) => Effect.Effect<void, EventSubSocket.ConnectionFailed | Helix.HelixError | MissingCredential>;
  readonly reconcile?: (
    accountId: AccountId,
  ) => Effect.Effect<void, Helix.HelixError | MissingCredential>;
  readonly disconnect: (accountId: AccountId) => Effect.Effect<void>;
}

export interface Context {
  readonly getAccountIds: Effect.Effect<ReadonlyArray<AccountId>>;
  readonly getHelix: (
    accountId: AccountId,
  ) => Effect.Effect<HttpApiClient.ForApi<typeof Helix.Api.HelixApi>, MissingCredential, never>;
  readonly getSubscriptions: (accountId: AccountId) => Effect.Effect<ReadonlyArray<string>>;
  readonly emit: (event: SubscriptionEvent.Any) => Effect.Effect<void>;
  readonly refresh: Effect.Effect<void>;
}

export type Make<R = never> = (
  context: Context,
) => Effect.Effect<Controller, never, R | Scope.Scope>;

export const helixError = <A, R>(
  effect: Effect.Effect<A, HttpClientError.HttpClientError | S.SchemaError, R>,
): Effect.Effect<A, Helix.HelixError, R> =>
  effect.pipe(
    Effect.catchTag("HttpClientError", Helix.fromHttpClientError),
    Effect.catchTag("SchemaError", (cause) => new Helix.HelixError({ reason: String(cause) })),
  );

export const definitionsFor = (subscriptions: ReadonlyArray<string>) =>
  subscriptions.flatMap((subscription) => {
    const definition = SUBSCRIPTIONS.find(([type]) => type === subscription);
    return definition === undefined
      ? []
      : [
          {
            type: definition[0],
            version: definition[1],
            condition: definition[2],
          },
        ];
  });

export const listSubscriptions = Effect.fnUntraced(function* (
  helix: HttpApiClient.ForApi<typeof Helix.Api.HelixApi>,
) {
  const subscriptions: Array<
    Effect.Success<ReturnType<typeof helix.eventsub.listSubscriptions>>["data"][number]
  > = [];
  let after: string | undefined;
  do {
    const response = yield* helixError(
      helix.eventsub.listSubscriptions({
        query: after === undefined ? {} : { after },
      }),
    );
    subscriptions.push(...response.data);
    after = response.pagination?.cursor;
  } while (after !== undefined && after.length > 0);
  return subscriptions;
});
