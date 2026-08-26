import { Effect, Schema } from "effect";

export class PolicyDeniedError extends Schema.TaggedError<PolicyDeniedError>()(
  "PolicyDenied",
  {},
) {}

export type Policy<E = PolicyDeniedError, R = never> = Effect.Effect<void, E, R>;

export const policy = <E, R>(
  predicate: () => Effect.Effect<boolean, E, R>,
): Policy<PolicyDeniedError | E, R> =>
  Effect.suspend(predicate).pipe(
    Effect.flatMap((allowed) => (allowed ? Effect.void : new PolicyDeniedError({}))),
  );

export const withPolicy =
  <E, R>(policy: Policy<E, R>) =>
  <A, E2, R2>(effect: Effect.Effect<A, E2, R2>): Effect.Effect<A, E | E2, R | R2> =>
    Effect.andThen(policy, effect);
