import { Effect, Schema } from "effect";

export const Status = Schema.Literals(["available", "expired", "unavailable"]);

export const Summary = Schema.Struct({
  provider: Schema.String,
  id: Schema.String,
  displayName: Schema.NullOr(Schema.String),
  status: Status,
  scopes: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  metadata: Schema.Record(Schema.String, Schema.Json).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({})),
  ),
});
export type Summary = typeof Summary.Type;

export const UnavailableReason = Schema.Struct({
  code: Schema.Literals(["no-provider", "not-connected", "request-failed"]),
  message: Schema.String,
});
export type UnavailableReason = typeof UnavailableReason.Type;

export const Catalog = Schema.Union([
  Schema.TaggedStruct("CredentialCatalogAvailable", {
    credentials: Schema.Array(Summary),
  }),
  Schema.TaggedStruct("CredentialCatalogUnavailable", {
    reason: UnavailableReason,
  }),
]);
export type Catalog = typeof Catalog.Type;

export const AuthIdentity = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
});
export const AuthStatus = Schema.Union([
  Schema.Struct({ state: Schema.Literal("disconnected") }),
  Schema.Struct({ state: Schema.Literal("pending"), verificationUrl: Schema.String }),
  Schema.Struct({ state: Schema.Literal("connected"), identity: AuthIdentity }),
]);
export type AuthStatus = typeof AuthStatus.Type;

export const AuthState = Schema.Struct({
  providerName: Schema.String,
  status: AuthStatus,
});
export type AuthState = typeof AuthState.Type;

export class AuthError extends Schema.TaggedError<AuthError>()("CredentialAuthError", {
  reason: Schema.String,
}) {}

export interface AuthController {
  readonly providerName: string;
  readonly status: Effect.Effect<AuthStatus, AuthError>;
  readonly start: Effect.Effect<AuthStatus, AuthError>;
  readonly poll: Effect.Effect<AuthStatus, AuthError>;
  readonly disconnect: Effect.Effect<void, AuthError>;
}

export const unavailable = (
  code: UnavailableReason["code"],
  message: string,
): Catalog => ({ _tag: "CredentialCatalogUnavailable", reason: { code, message } });

export * as Credential from "./Credential.ts";
