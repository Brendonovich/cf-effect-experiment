import { Effect } from "effect";

import type {
  CredentialSummary,
  GenerateTextRequest,
  OAuthAttempt,
  OAuthMethodSummary,
  OAuthStatus,
  RequestFailure,
  Target,
  TargetType,
} from "./Definition.ts";

export interface Instance {
  readonly generateText: (
    input: typeof GenerateTextRequest.Type,
  ) => Effect.Effect<string, RequestFailure>;
  readonly listModels: Effect.Effect<ReadonlyArray<string>, RequestFailure>;
  readonly listCredentials: Effect.Effect<
    ReadonlyArray<typeof CredentialSummary.Type>,
    RequestFailure
  >;
  readonly listOAuthMethods: Effect.Effect<
    ReadonlyArray<typeof OAuthMethodSummary.Type>,
    RequestFailure
  >;
  readonly connectKey: (input: {
    readonly integrationID: string;
    readonly key: string;
  }) => Effect.Effect<void, RequestFailure>;
  readonly removeCredential: (credentialID: string) => Effect.Effect<void, RequestFailure>;
  readonly startOAuth: (input: {
    readonly integrationID: string;
    readonly methodID: string;
  }) => Effect.Effect<typeof OAuthAttempt.Type, RequestFailure>;
  readonly oauthStatus: (input: {
    readonly integrationID: string;
    readonly attemptID: string;
  }) => Effect.Effect<typeof OAuthStatus.Type, RequestFailure>;
  readonly completeOAuth: (input: {
    readonly integrationID: string;
    readonly attemptID: string;
    readonly code: string;
  }) => Effect.Effect<void, RequestFailure>;
  readonly cancelOAuth: (input: {
    readonly integrationID: string;
    readonly attemptID: string;
  }) => Effect.Effect<void, RequestFailure>;
}

/** Resolves logical OpenCode targets without exposing platform provisioning details. */
export interface Instances {
  readonly defaultTarget: TargetType;
  readonly availableTargets: ReadonlyArray<TargetType>;
  readonly resolve: (target: Target) => Effect.Effect<Instance, RequestFailure>;
}
