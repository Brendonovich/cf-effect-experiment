import { Engine } from "@macrograph/plugin";
import { Config, Effect, Layer, Option, Redacted, Ref, Scope, Semaphore, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

export const CloudCredential = Schema.Struct({
  provider: Schema.String,
  id: Schema.String,
  displayName: Schema.NullOr(Schema.String),
  token: Schema.Struct({
    access_token: Schema.String,
    expires_in: Schema.Number,
    refresh_token: Schema.optional(Schema.String),
    token_type: Schema.String,
    issuedAt: Schema.Number,
  }),
});

const CloudCredentialList = Schema.Array(CloudCredential);

export interface Options {
  readonly baseUrl: string;
  readonly token: Redacted.Redacted<string>;
  readonly clientId?: string;
}

const toEngineCredential = (credential: typeof CloudCredential.Type): Engine.Credential => ({
  id: credential.id,
  provider: credential.provider,
  displayName: credential.displayName,
  token: { access: credential.token.access_token },
});

export const make = (options: Options) =>
  Effect.gen(function* () {
    const httpClient = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
    const baseUrl = options.baseUrl
      .replace(/^https:\/\/macrograph\.app(?=\/|$)/, "https://www.macrograph.app")
      .replace(/\/$/, "");
    const state = yield* Ref.make<Option.Option<Array<Engine.Credential>>>(Option.none());
    const lock = yield* Semaphore.make(1);
    const subscribers = new Set<(credential: Engine.Credential) => Effect.Effect<void>>();

    const execute = <A, I>(
      request: HttpClientRequest.HttpClientRequest,
      schema: Schema.Codec<A, I>,
    ) =>
      request.pipe(
        HttpClientRequest.setHeaders({
          authorization: `Bearer ${Redacted.value(options.token)}`,
          "client-id": options.clientId ?? "macrograph-server",
        }),
        httpClient.execute,
        Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      );

    const fetchAll = Effect.gen(function* () {
      const credentials = yield* execute(
        HttpClientRequest.get(`${baseUrl}/credentials`),
        CloudCredentialList,
      ).pipe(Effect.map((values) => values.map(toEngineCredential)));
      yield* Ref.set(state, Option.some(credentials));
      yield* Effect.forEach(
        subscribers,
        (subscriber) => Effect.forEach(credentials, subscriber, { discard: true }),
        { discard: true },
      );
      return credentials;
    });

    const get = lock
      .withPermit(
        Ref.get(state).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => fetchAll,
              onSome: Effect.succeed,
            }),
          ),
        ),
      )
      .pipe(
        Effect.catchCause(() =>
          Effect.logWarning(`Could not fetch credentials from ${baseUrl}`).pipe(
            Effect.as<Array<Engine.Credential>>([]),
          ),
        ),
      );

    const refresh = (provider: string, id: string) =>
      lock.withPermit(
        execute(
          HttpClientRequest.post(
            `${baseUrl}/credentials/${encodeURIComponent(provider)}/${encodeURIComponent(id)}/refresh`,
          ),
          CloudCredential,
        ).pipe(
          Effect.andThen(fetchAll),
          Effect.flatMap((credentials) => {
            const credential = credentials.find(
              (candidate) => candidate.provider === provider && candidate.id === id,
            );
            return credential === undefined
              ? Effect.die(`Credential ${provider}/${id} was not returned by macrograph.app`)
              : Effect.succeed(credential);
          }),
          Effect.orDie,
        ),
      );

    const subscribe = (
      callback: (credential: Engine.Credential) => Effect.Effect<void>,
    ): Effect.Effect<void, never, Scope.Scope> =>
      Effect.gen(function* () {
        const scope = yield* Effect.scope;
        subscribers.add(callback);
        yield* Scope.addFinalizerExit(scope, () =>
          Effect.sync(() => {
            subscribers.delete(callback);
          }),
        );
      });

    return { get, refresh, subscribe };
  });

export const layer = (options: Options) => Layer.effect(Engine.Credentials)(make(options));

export const defaultLayer = Layer.unwrap(
  Effect.map(
    Config.all({
      baseUrl: Config.string("MACROGRAPH_CLOUD_BASE_URL").pipe(
        Config.withDefault("https://www.macrograph.app/api"),
      ),
      token: Config.redacted("MACROGRAPH_CLOUD_TOKEN"),
    }).pipe(Config.option),
    Option.match({
      onNone: () => Engine.emptyCredentialsLayer,
      onSome: layer,
    }),
  ),
);

export * as CloudCredentials from "./CloudCredentials.ts";
