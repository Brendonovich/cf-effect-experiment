import { Effect } from "effect";

import type {
  ConnectionId,
  ConnectionTarget,
  ConnectionType,
  CredentialSummary,
  OAuthAttempt,
  OAuthMethodSummary,
  OAuthStatus,
  RequestFailure,
} from "./Definition.ts";

export interface Instance {
  /** The config a managed instance is running, when the platform defers applying saved changes. */
  readonly appliedConfig?: string;
  readonly generateText: (input: {
    readonly prompt: string;
    readonly model: string;
  }) => Effect.Effect<string, RequestFailure>;
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

/** Resolves explicit OpenCode connections without exposing platform provisioning details. */
export interface Instances {
  readonly connectionTypes: ReadonlyArray<ConnectionType>;
  readonly resolve: (connection: {
    readonly id: ConnectionId;
    readonly target: ConnectionTarget;
  }) => Effect.Effect<Instance, RequestFailure>;
}
