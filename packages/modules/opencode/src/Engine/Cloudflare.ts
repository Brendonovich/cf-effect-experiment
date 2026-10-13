import { Effect, Layer } from "effect";

import {
  ClientRpcs,
  type ClientState,
  type OAuthAttempt,
  type OAuthStatus,
  OpenCodeEngine,
  RequestFailure,
  RuntimeRpcs,
} from "../Definition.ts";

export interface Service {
  readonly generateText: (input: {
    readonly prompt: string;
    readonly model: string;
  }) => Effect.Effect<string, unknown>;
  readonly listModels: () => Effect.Effect<ReadonlyArray<string>, unknown>;
  readonly clientState: () => Effect.Effect<typeof ClientState.Type, unknown>;
  readonly connectKey: (input: {
    readonly integrationID: string;
    readonly key: string;
  }) => Effect.Effect<void, unknown>;
  readonly removeCredential: (credentialID: string) => Effect.Effect<void, unknown>;
  readonly startOAuth: (input: {
    readonly integrationID: string;
    readonly methodID: string;
  }) => Effect.Effect<typeof OAuthAttempt.Type, unknown>;
  readonly oauthStatus: (input: {
    readonly integrationID: string;
    readonly attemptID: string;
  }) => Effect.Effect<typeof OAuthStatus.Type, unknown>;
  readonly completeOAuth: (input: {
    readonly integrationID: string;
    readonly attemptID: string;
    readonly code: string;
  }) => Effect.Effect<void, unknown>;
  readonly cancelOAuth: (input: {
    readonly integrationID: string;
    readonly attemptID: string;
  }) => Effect.Effect<void, unknown>;
}

const reason = (cause: unknown) =>
  typeof cause === "object" &&
  cause !== null &&
  "reason" in cause &&
  typeof cause.reason === "string"
    ? cause.reason
    : cause instanceof Error && cause.message.length > 0
      ? cause.message
      : "OpenCode request failed";

export const makeLayer = (service: Service) =>
  OpenCodeEngine.toLayer((context) => {
    const request = <A>(run: Effect.Effect<A, unknown>) =>
      run.pipe(Effect.mapError((cause) => new RequestFailure({ reason: reason(cause) })));
    return Effect.succeed(
      OpenCodeEngine.of({
        resources: Layer.empty,
        rpcs: RuntimeRpcs.toLayer({
          OpenCodeGenerateText: (input) => request(service.generateText(input)),
          OpenCodeListModels: () => request(service.listModels()),
        }),
        client: {
          state: request(service.clientState()).pipe(
            Effect.orElseSucceed(() => ({
              mode: "cloudflare" as const,
              credentials: [],
              oauthMethods: [],
            })),
          ),
          rpcs: ClientRpcs.toLayer({
            OpenCodeConnectKey: ({ integrationID, key }) =>
              request(service.connectKey({ integrationID, key })).pipe(
                Effect.tap(() => context.client.refresh),
              ),
            OpenCodeRemoveCredential: ({ credentialID }) =>
              request(service.removeCredential(credentialID)).pipe(
                Effect.tap(() => context.client.refresh),
              ),
            OpenCodeStartOAuth: (input) => request(service.startOAuth(input)),
            OpenCodeOAuthStatus: (input) =>
              request(service.oauthStatus(input)).pipe(
                Effect.tap((status) =>
                  status.status === "complete" ? context.client.refresh : Effect.void,
                ),
              ),
            OpenCodeCompleteOAuth: (input) =>
              request(service.completeOAuth(input)).pipe(Effect.tap(() => context.client.refresh)),
            OpenCodeCancelOAuth: (input) => request(service.cancelOAuth(input)),
          }),
        },
      }),
    );
  });

export default makeLayer;
