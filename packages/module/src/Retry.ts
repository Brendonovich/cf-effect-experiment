import { Data } from "effect";

/**
 * Permission to retry the entire failed node invocation with the same inputs
 * and invocation identity. The execution environment owns the retry policy.
 *
 * Only fail with this error when repeating all work performed by the node is
 * safe, including any writes that already succeeded. A retryable client error
 * alone does not establish that the whole node is safe to repeat.
 *
 * Preserve the original error (or Effect Cause) in `cause` rather than converting
 * it to a string. For example, after establishing that the node can be retried:
 *
 * ```ts
 * effect.pipe(Effect.mapError((cause) => new Retry({ cause })))
 * ```
 *
 * This signal applies to a reported failure; it does not establish that replay
 * after a worker crash is safe, or make an external operation idempotent.
 */
export class Retry extends Data.TaggedError("Retry")<{
  readonly message?: string;
  readonly cause?: unknown;
}> {}
