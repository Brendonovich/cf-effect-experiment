import { RequestFailure } from "@macrograph/module-opencode/Definition";
import { create, type Service as WorkerdService } from "@macrograph/opencode-workerd";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

const reason = (cause: unknown) =>
  typeof cause === "object" &&
  cause !== null &&
  "reason" in cause &&
  typeof cause.reason === "string"
    ? cause.reason
    : cause instanceof Error && cause.message.length > 0
      ? cause.message
      : "OpenCode request failed";

export const makeService = (service: WorkerdService) => {
  const request = <A>(run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => new RequestFailure({ reason: reason(cause) }),
    });
  return {
    generateText: (input: { readonly prompt: string; readonly model: string }) =>
      request(() => service.generateText(input)),
    listModels: () => request(() => service.listModels()),
    clientState: () =>
      request(() => Promise.all([service.listCredentials(), service.listOAuthMethods()])).pipe(
        Effect.map(([credentials, oauthMethods]) => ({
          mode: "cloudflare" as const,
          credentials: credentials.map(({ id, integrationID, label, active }) => ({
            id,
            integrationID,
            label,
            active,
          })),
          oauthMethods,
        })),
      ),
    connectKey: (input: { readonly integrationID: string; readonly key: string }) => {
      const integrationID = input.integrationID.trim();
      const key = input.key.trim();
      if (integrationID.length === 0 || key.length === 0)
        return Effect.fail(new RequestFailure({ reason: "Provider ID and API key are required" }));
      return request(() => service.connectKey({ integrationID, key }));
    },
    removeCredential: (credentialID: string) =>
      request(() => service.removeCredential(credentialID)),
    startOAuth: (input: { readonly integrationID: string; readonly methodID: string }) =>
      request(() => service.startOAuth(input)),
    oauthStatus: (input: { readonly integrationID: string; readonly attemptID: string }) =>
      request(() => service.oauthStatus(input)),
    completeOAuth: (input: {
      readonly integrationID: string;
      readonly attemptID: string;
      readonly code: string;
    }) => request(() => service.completeOAuth(input)),
    cancelOAuth: (input: { readonly integrationID: string; readonly attemptID: string }) =>
      request(() => service.cancelOAuth(input)),
  };
};

/** Owns one embedded OpenCode host and credential database per MacroGraph project. */
export default class OpenCodeDO extends Cloudflare.DurableObject<OpenCodeDO>()(
  "OpenCodeDO",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    return Effect.gen(function* () {
      const service = yield* Effect.tryPromise(() => create(state.raw.storage)).pipe(Effect.orDie);
      return makeService(service);
    });
  }),
) {}
