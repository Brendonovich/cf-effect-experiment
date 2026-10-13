import { Effect, Layer } from "effect";

import {
  ClientRpcs,
  type ClientState,
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
            Effect.orElseSucceed(() => ({ mode: "cloudflare" as const, credentials: [] })),
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
          }),
        },
      }),
    );
  });

export default makeLayer;
