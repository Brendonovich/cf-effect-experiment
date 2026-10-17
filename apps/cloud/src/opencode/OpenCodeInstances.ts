import type { Instance, Instances } from "@macrograph/module-opencode/Instance";

import { RequestFailure } from "@macrograph/module-opencode/Definition";
import { connectRemote, type Service } from "@macrograph/opencode-workerd";
import { Effect } from "effect";

export interface Namespace {
  readonly getByName: (name: string) => {
    readonly ensure: (config: string) => Effect.Effect<void, unknown>;
    readonly generateText: (input: {
      readonly prompt: string;
      readonly model: string;
    }) => Effect.Effect<string, unknown>;
    readonly listModels: () => Effect.Effect<ReadonlyArray<string>, unknown>;
    readonly listCredentials: () => Effect.Effect<
      ReadonlyArray<{
        readonly id: string;
        readonly integrationID: string;
        readonly label: string;
        readonly active: boolean;
      }>,
      unknown
    >;
    readonly listOAuthMethods: () => Effect.Effect<
      ReadonlyArray<{
        readonly integrationID: string;
        readonly integrationName: string;
        readonly methodID: string;
        readonly label: string;
      }>,
      unknown
    >;
    readonly connectKey: (input: {
      readonly integrationID: string;
      readonly key: string;
    }) => Effect.Effect<void, unknown>;
    readonly removeCredential: (credentialID: string) => Effect.Effect<void, unknown>;
    readonly startOAuth: (input: {
      readonly integrationID: string;
      readonly methodID: string;
    }) => Effect.Effect<
      {
        readonly integrationID: string;
        readonly attemptID: string;
        readonly url: string;
        readonly instructions: string;
        readonly mode: "auto" | "code";
        readonly expires: number;
      },
      unknown
    >;
    readonly oauthStatus: (input: {
      readonly integrationID: string;
      readonly attemptID: string;
    }) => Effect.Effect<
      | { readonly status: "pending" }
      | { readonly status: "complete" }
      | { readonly status: "failed"; readonly message: string }
      | { readonly status: "expired" },
      unknown
    >;
    readonly completeOAuth: (input: {
      readonly integrationID: string;
      readonly attemptID: string;
      readonly code: string;
    }) => Effect.Effect<void, unknown>;
    readonly cancelOAuth: (input: {
      readonly integrationID: string;
      readonly attemptID: string;
    }) => Effect.Effect<void, unknown>;
  };
}

const failure = (cause: unknown) =>
  new RequestFailure({
    reason:
      cause instanceof Error && cause.message.length > 0
        ? cause.message
        : "OpenCode request failed",
  });

const remoteInstance = (service: Service): Instance => ({
  generateText: (input) =>
    Effect.tryPromise({ try: () => service.generateText(input), catch: failure }),
  listModels: Effect.tryPromise({ try: () => service.listModels(), catch: failure }),
  listCredentials: Effect.tryPromise({ try: () => service.listCredentials(), catch: failure }),
  listOAuthMethods: Effect.tryPromise({ try: () => service.listOAuthMethods(), catch: failure }),
  connectKey: (input) =>
    Effect.tryPromise({ try: () => service.connectKey(input), catch: failure }),
  removeCredential: (credentialID) =>
    Effect.tryPromise({ try: () => service.removeCredential(credentialID), catch: failure }),
  startOAuth: (input) =>
    Effect.tryPromise({ try: () => service.startOAuth(input), catch: failure }),
  oauthStatus: (input) =>
    Effect.tryPromise({ try: () => service.oauthStatus(input), catch: failure }),
  completeOAuth: (input) =>
    Effect.tryPromise({ try: () => service.completeOAuth(input), catch: failure }),
  cancelOAuth: (input) =>
    Effect.tryPromise({ try: () => service.cancelOAuth(input), catch: failure }),
});

export const make = (
  projectId: Effect.Effect<string, RequestFailure>,
  namespace: Namespace,
  connect: typeof connectRemote = connectRemote,
): Instances => ({
  defaultTarget: "managed",
  availableTargets: ["managed", "remote"],
  resolve: (target) => {
    if (target.type === "remote")
      return Effect.tryPromise({
        try: () => connect({ url: target.url, password: target.password }),
        catch: failure,
      }).pipe(Effect.map(remoteInstance));
    const config = target.type === "managed" ? target.config : "{}";
    return projectId.pipe(
      Effect.map((id) => namespace.getByName(id)),
      Effect.tap((stub) => stub.ensure(config).pipe(Effect.mapError(failure))),
      Effect.map(
        (stub): Instance => ({
          generateText: (input) => stub.generateText(input).pipe(Effect.mapError(failure)),
          listModels: stub.listModels().pipe(Effect.mapError(failure)),
          listCredentials: stub.listCredentials().pipe(Effect.mapError(failure)),
          listOAuthMethods: stub.listOAuthMethods().pipe(Effect.mapError(failure)),
          connectKey: (input) => stub.connectKey(input).pipe(Effect.mapError(failure)),
          removeCredential: (credentialID) =>
            stub.removeCredential(credentialID).pipe(Effect.mapError(failure)),
          startOAuth: (input) => stub.startOAuth(input).pipe(Effect.mapError(failure)),
          oauthStatus: (input) => stub.oauthStatus(input).pipe(Effect.mapError(failure)),
          completeOAuth: (input) => stub.completeOAuth(input).pipe(Effect.mapError(failure)),
          cancelOAuth: (input) => stub.cancelOAuth(input).pipe(Effect.mapError(failure)),
        }),
      ),
    );
  },
});
