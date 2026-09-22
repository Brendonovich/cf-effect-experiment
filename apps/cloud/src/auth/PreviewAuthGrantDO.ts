import { RuntimeContext as AlchemyRuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

export interface PreviewGrant {
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly userId: string;
  readonly email: string;
  readonly expiresAt: number;
}

const key = (code: string) => `grant:${code}`;

export default class PreviewAuthGrantDO extends Cloudflare.DurableObject<PreviewAuthGrantDO>()(
  "PreviewAuthGrantDO",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    return Effect.gen(function* () {
      const runtimeContext = yield* Effect.context<AlchemyRuntimeContext>();
      return {
        issue: (grant: Omit<PreviewGrant, "expiresAt">) =>
          Effect.gen(function* () {
            const code = crypto.randomUUID();
            yield* state.storage.put(key(code), {
              ...grant,
              expiresAt: Date.now() + 5 * 60 * 1_000,
            });
            return code;
          }).pipe(Effect.provide(runtimeContext), Effect.orDie),
        consume: (code: string, redirectUri: string, codeChallenge: string) =>
          state.storage
            .transaction((transaction) =>
              Effect.gen(function* () {
                const grant = yield* transaction.get<PreviewGrant>(key(code));
                if (grant === undefined) return undefined;
                if (grant.expiresAt <= Date.now()) {
                  yield* transaction.delete(key(code));
                  return undefined;
                }
                if (grant.redirectUri !== redirectUri || grant.codeChallenge !== codeChallenge)
                  return undefined;
                yield* transaction.delete(key(code));
                return grant;
              }),
            )
            .pipe(Effect.provide(runtimeContext), Effect.orDie),
      };
    });
  }),
) {}
