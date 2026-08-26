import { HttpEndpoint } from "@macrograph/plugin";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer, Option, Redacted, Schema } from "effect";

const LogicalStorageKey = Schema.String.pipe(Schema.brand("HttpEndpointLogicalStorageKey"));
const IdStorageKey = Schema.String.pipe(Schema.brand("HttpEndpointIdStorageKey"));
const SecretStorageKey = Schema.String.pipe(Schema.brand("HttpEndpointSecretStorageKey"));

interface StoredEndpoint {
  readonly id: HttpEndpoint.Id;
  readonly schema: {
    readonly id: HttpEndpoint.HandlerId;
    readonly displayName: string;
  };
  readonly instanceKey: HttpEndpoint.InstanceKey;
  readonly displayName?: string;
  readonly metadata: unknown;
}

export interface Options {
  readonly namespace: string;
  readonly makeUrl: (id: HttpEndpoint.Id) => string;
}

export const layer = (options: Options) =>
  Layer.effect(HttpEndpoint.Host)(
    Effect.gen(function* () {
      const state = yield* Cloudflare.DurableObjectState;
      const storage = state.raw.storage;
      const logicalKey = (
        handlerId: HttpEndpoint.HandlerId,
        instanceKey: HttpEndpoint.InstanceKey,
      ) =>
        LogicalStorageKey.make(
          `http-endpoints/${options.namespace}/logical/${JSON.stringify([handlerId, instanceKey])}`,
        );
      const idKey = (id: HttpEndpoint.Id) =>
        IdStorageKey.make(`http-endpoints/${options.namespace}/id/${id}`);
      const secretKey = (id: HttpEndpoint.Id) =>
        SecretStorageKey.make(`http-endpoints/${options.namespace}/secret/${id}`);
      const attempt = <A>(operation: () => Promise<A>) =>
        Effect.tryPromise({
          try: operation,
          catch: (cause) => new HttpEndpoint.ProvisionError({ cause }),
        });

      return HttpEndpoint.Host.of({
        ensure: (handler, endpoint) =>
          Effect.gen(function* () {
            const metadata = yield* Schema.encodeUnknownEffect(handler.metadata)(
              endpoint.metadata,
            ).pipe(Effect.mapError((cause) => new HttpEndpoint.ProvisionError({ cause })));
            const instanceKey = HttpEndpoint.InstanceKey.make(endpoint.instanceKey);
            const key = logicalKey(handler.id, instanceKey);
            const stored = yield* attempt(() =>
              storage.transaction(async (transaction) => {
                const existing = await transaction.get<StoredEndpoint>(key);
                const next: StoredEndpoint = {
                  id: existing?.id ?? HttpEndpoint.Id.make(crypto.randomUUID()),
                  schema: { id: handler.id, displayName: handler.displayName },
                  instanceKey,
                  ...(endpoint.displayName === undefined
                    ? {}
                    : { displayName: endpoint.displayName }),
                  metadata,
                };
                await transaction.put({ [key]: next, [idKey(next.id)]: next });
                return next;
              }),
            );
            return {
              id: stored.id,
              url: options.makeUrl(stored.id),
              schema: stored.schema,
              instanceKey,
              ...(stored.displayName === undefined ? {} : { displayName: stored.displayName }),
              metadata: endpoint.metadata,
            };
          }),
        get: (handler, instanceKey) =>
          Effect.gen(function* () {
            const stored = yield* attempt(() =>
              storage.get<StoredEndpoint>(
                logicalKey(handler.id, HttpEndpoint.InstanceKey.make(instanceKey)),
              ),
            );
            if (stored === undefined) return Option.none();
            const metadata = yield* Schema.decodeUnknownEffect(handler.metadata)(
              stored.metadata,
            ).pipe(Effect.mapError((cause) => new HttpEndpoint.ProvisionError({ cause })));
            return Option.some({
              id: stored.id,
              url: options.makeUrl(stored.id),
              schema: stored.schema,
              instanceKey: stored.instanceKey,
              ...(stored.displayName === undefined ? {} : { displayName: stored.displayName }),
              metadata,
            });
          }),
        remove: (handler, instanceKey) => {
          const key = logicalKey(handler.id, HttpEndpoint.InstanceKey.make(instanceKey));
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
                schema: endpoint.schema,
                instanceKey: endpoint.instanceKey,
                ...(endpoint.displayName === undefined
                  ? {}
                  : { displayName: endpoint.displayName }),
                metadata: endpoint.metadata,
              })),
            );
          }),
        secret: (endpointId) =>
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
    }),
  );

export * as DurableObjectHttpEndpointHost from "./DurableObjectHttpEndpointHost.ts";
