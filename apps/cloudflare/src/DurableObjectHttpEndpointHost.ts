import { HttpEndpoint } from "@macrograph/plugin";
import * as Cloudflare from "alchemy/Cloudflare";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";

interface StoredEndpoint {
  readonly id: string;
  readonly handlerId: string;
  readonly instanceKey: string;
  readonly metadata: unknown;
}

export interface Options {
  readonly namespace: string;
  readonly makeUrl: (id: string) => string;
}

export const layer = (options: Options) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const state = yield* Cloudflare.DurableObjectState;
      const storage = state.raw.storage;
      const logicalKey = (handlerId: string, instanceKey: string) =>
        `http-endpoints/${options.namespace}/logical/${JSON.stringify([handlerId, instanceKey])}`;
      const idKey = (id: string) => `http-endpoints/${options.namespace}/id/${id}`;
      const secretKey = (id: string) => `http-endpoints/${options.namespace}/secret/${id}`;
      const attempt = <A>(operation: () => Promise<A>) =>
        Effect.tryPromise({
          try: operation,
          catch: (cause) => new HttpEndpoint.ProvisionError({ cause }),
        });

      const host = HttpEndpoint.Host.of({
        ensure: (handler, endpoint) =>
          Effect.gen(function* () {
            const metadata = yield* Schema.encodeUnknownEffect(handler.metadata)(
              endpoint.metadata,
            ).pipe(Effect.mapError((cause) => new HttpEndpoint.ProvisionError({ cause })));
            const key = logicalKey(handler.id, endpoint.instanceKey);
            const stored = yield* attempt(() =>
              storage.transaction(async (transaction) => {
                const existing = await transaction.get<StoredEndpoint>(key);
                const next: StoredEndpoint =
                  existing === undefined
                    ? {
                        id: crypto.randomUUID(),
                        handlerId: handler.id,
                        instanceKey: endpoint.instanceKey,
                        metadata,
                      }
                    : { ...existing, metadata };
                await transaction.put({ [key]: next, [idKey(next.id)]: next });
                return next;
              }),
            );
            return {
              id: stored.id,
              url: options.makeUrl(stored.id),
              handlerId: handler.id,
              instanceKey: endpoint.instanceKey,
              metadata: endpoint.metadata,
            };
          }),
        get: (handler, instanceKey) =>
          Effect.gen(function* () {
            const stored = yield* attempt(() =>
              storage.get<StoredEndpoint>(logicalKey(handler.id, instanceKey)),
            );
            if (stored === undefined) return Option.none();
            const metadata = yield* Schema.decodeUnknownEffect(handler.metadata)(
              stored.metadata,
            ).pipe(Effect.mapError((cause) => new HttpEndpoint.ProvisionError({ cause })));
            return Option.some({
              id: stored.id,
              url: options.makeUrl(stored.id),
              handlerId: stored.handlerId,
              instanceKey: stored.instanceKey,
              metadata,
            });
          }),
        remove: (handler, instanceKey) => {
          const key = logicalKey(handler.id, instanceKey);
          return attempt(() =>
            storage.transaction(async (transaction) => {
              const stored = await transaction.get<StoredEndpoint>(key);
              if (stored !== undefined)
                await transaction.delete([key, idKey(stored.id), secretKey(stored.id)]);
            }),
          );
        },
        lookup: (id) =>
          Effect.gen(function* () {
            const stored = yield* attempt(() => storage.get<StoredEndpoint>(idKey(id)));
            return Option.fromNullishOr(stored).pipe(
              Option.map((endpoint) => ({
                id: endpoint.id,
                url: options.makeUrl(endpoint.id),
                handlerId: endpoint.handlerId,
                instanceKey: endpoint.instanceKey,
                metadata: endpoint.metadata,
              })),
            );
          }),
      });
      const secrets = HttpEndpoint.SecretStore.of({
        upsert: (endpointId) =>
          attempt(() =>
            storage.transaction(async (transaction) => {
              const key = secretKey(endpointId);
              const existing = await transaction.get<string>(key);
              if (existing !== undefined) return existing;

              const bytes = crypto.getRandomValues(new Uint8Array(32));
              const secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
                "",
              );
              await transaction.put(key, secret);
              return secret;
            }),
          ).pipe(Effect.orDie, Effect.map(Redacted.make)),
      });

      return Context.make(HttpEndpoint.Host, host).pipe(
        Context.add(HttpEndpoint.SecretStore, secrets),
      );
    }),
  );

export * as DurableObjectHttpEndpointHost from "./DurableObjectHttpEndpointHost.ts";
