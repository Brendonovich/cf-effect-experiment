import { CloudCredentials } from "@macrograph/project-host";
import { RuntimeContext as AlchemyRuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect, Redacted, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";

import { ObservabilityLayer } from "../Observability.ts";

const RegistrationStart = Schema.Struct({
  id: Schema.String,
  userCode: Schema.String,
  verification_uri: Schema.String,
  verification_uri_complete: Schema.String,
});
const RegistrationGrant = Schema.Struct({ token: Schema.String });
const Registration = Schema.Struct({ ownerId: Schema.String });
const CloudUser = Schema.NullOr(Schema.Struct({ id: Schema.String, email: Schema.String }));
const RegistrationError = Schema.TaggedStruct("ServerRegistrationError", {
  code: Schema.Literals(["authorization_pending", "incorrect_id", "access_denied"]),
});
const RegistrationResult = Schema.Union([RegistrationGrant, RegistrationError]);

const sessionKey = "auth-session";
const pendingKey = "pending-registration";

export type Status =
  | { readonly state: "disconnected" }
  | { readonly state: "pending"; readonly verificationUrl: string }
  | { readonly state: "connected"; readonly userId: string; readonly email: string };

interface AuthSession {
  readonly token: string;
  readonly userId: string;
  readonly email?: string;
  readonly expiresAt: number;
}

export default class CloudAuth extends Cloudflare.DurableObject<CloudAuth>()(
  "CloudAuth",
  Effect.gen(function* () {
    const durableState = yield* Cloudflare.DurableObjectState;
    const baseUrl = yield* Config.string("MACROGRAPH_CLOUD_BASE_URL").pipe(
      Config.withDefault("https://www.macrograph.app/api"),
      Effect.orDie,
      Effect.map((url) =>
        url
          .replace(/^https:\/\/macrograph\.app(?=\/|$)/, "https://www.macrograph.app")
          .replace(/\/$/, ""),
      ),
    );
    return Effect.gen(function* () {
      const runtimeContext = yield* Effect.context<AlchemyRuntimeContext>();
      const httpClient = yield* HttpClient.HttpClient;
      const storageGet = <A>(key: string) =>
        durableState.storage.get<A>(key).pipe(Effect.provide(runtimeContext));
      const storagePut = (key: string, value: unknown) =>
        durableState.storage.put(key, value).pipe(Effect.provide(runtimeContext));
      const storageDelete = (key: string) =>
        durableState.storage.delete(key).pipe(Effect.provide(runtimeContext));
      let credentialToken: string | undefined;
      let credentialClient: Effect.Success<ReturnType<typeof CloudCredentials.make>> | undefined;

      const getSession = Effect.gen(function* () {
        const session = yield* storageGet<AuthSession>(sessionKey);
        if (session === undefined || session.expiresAt > Date.now()) return session;
        yield* storageDelete(sessionKey);
        return undefined;
      });

      const getCredentialClient = Effect.fnUntraced(function* () {
        const session = yield* getSession;
        if (session === undefined) return undefined;
        const token = session.token;
        if (credentialClient !== undefined && credentialToken === token) return credentialClient;
        credentialToken = token;
        credentialClient = yield* CloudCredentials.make({
          baseUrl,
          token: Redacted.make(token),
        }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient));
        return credentialClient;
      });

      const getCloudUser = Effect.fnUntraced(function* (token: string) {
        const user = yield* HttpClientRequest.get(`${baseUrl}/user`).pipe(
          HttpClientRequest.setHeaders({
            authorization: `Bearer ${token}`,
            "client-id": "macrograph-server",
          }),
          HttpClient.filterStatusOk(httpClient).execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(CloudUser)),
          Effect.orDie,
        );
        if (user === null) return yield* Effect.die("Connected Macrograph Cloud user not found");
        return user;
      });

      const connectedStatus = Effect.fnUntraced(function* (session: AuthSession) {
        if (session.email !== undefined) {
          return { state: "connected" as const, userId: session.userId, email: session.email };
        }
        const user = yield* getCloudUser(session.token);
        yield* storagePut(sessionKey, { ...session, email: user.email } satisfies AuthSession);
        return { state: "connected" as const, userId: session.userId, email: user.email };
      });

      const status = Effect.fnUntraced(function* (): Effect.fn.Return<Status> {
        const session = yield* getSession;
        if (session !== undefined) return yield* connectedStatus(session);
        const pending = yield* storageGet<{
          readonly id: string;
          readonly verificationUrl: string;
        }>(pendingKey);
        return pending === undefined
          ? { state: "disconnected" }
          : { state: "pending", verificationUrl: pending.verificationUrl };
      });

      const start = Effect.fnUntraced(function* () {
        const current = yield* status();
        if (current.state !== "disconnected") return current;
        const registration = yield* HttpClientRequest.post(
          `${baseUrl}/server/registration/start`,
        ).pipe(
          HttpClient.filterStatusOk(httpClient).execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(RegistrationStart)),
          Effect.orDie,
        );
        yield* storagePut(pendingKey, {
          id: registration.id,
          verificationUrl: registration.verification_uri_complete,
        });
        return {
          state: "pending" as const,
          verificationUrl: registration.verification_uri_complete,
        };
      });

      const poll = Effect.fnUntraced(function* (): Effect.fn.Return<Status> {
        const session = yield* getSession;
        if (session !== undefined) return yield* connectedStatus(session);
        const pending = yield* storageGet<{
          readonly id: string;
          readonly verificationUrl: string;
        }>(pendingKey);
        if (pending === undefined) return { state: "disconnected" };

        const result = yield* HttpClientRequest.post(`${baseUrl}/server/registration`).pipe(
          HttpClientRequest.bodyJsonUnsafe({ id: pending.id }),
          httpClient.execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(RegistrationResult)),
          Effect.orDie,
        );
        if ("code" in result) {
          if (result.code === "authorization_pending") {
            return {
              state: "pending",
              verificationUrl: pending.verificationUrl,
            };
          }
          yield* storageDelete(pendingKey);
          return { state: "disconnected" };
        }

        yield* storageDelete(pendingKey);
        const registration = yield* HttpClientRequest.get(`${baseUrl}/server/registration`).pipe(
          HttpClientRequest.setHeaders({
            authorization: `Bearer ${result.token}`,
            "client-id": "macrograph-server",
          }),
          HttpClient.filterStatusOk(httpClient).execute,
          Effect.flatMap(HttpClientResponse.schemaBodyJson(Registration)),
          Effect.orDie,
        );
        const user = yield* getCloudUser(result.token);
        yield* storagePut(sessionKey, {
          token: result.token,
          userId: registration.ownerId,
          email: user.email,
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        } satisfies AuthSession);
        credentialClient = undefined;
        credentialToken = undefined;
        return { state: "connected", userId: registration.ownerId, email: user.email };
      });

      const disconnect = Effect.fnUntraced(function* () {
        yield* storageDelete(sessionKey);
        yield* storageDelete(pendingKey);
        credentialClient = undefined;
        credentialToken = undefined;
      });

      const userId = Effect.fnUntraced(function* () {
        return (yield* getSession)?.userId;
      });

      const getCredentials = Effect.fnUntraced(function* () {
        const client = yield* getCredentialClient();
        return client === undefined ? [] : yield* client.get;
      });

      const refreshCredential = Effect.fnUntraced(function* (provider: string, id: string) {
        const client = yield* getCredentialClient();
        if (client === undefined) return yield* Effect.die("Macrograph Cloud is not connected");
        return yield* client.refresh(provider, id);
      });

      return {
        status,
        start,
        poll,
        disconnect,
        userId,
        getCredentials,
        refreshCredential,
      };
    }).pipe(Effect.provide(FetchHttpClient.layer));
  }).pipe(Effect.provide(ObservabilityLayer)),
) {}
