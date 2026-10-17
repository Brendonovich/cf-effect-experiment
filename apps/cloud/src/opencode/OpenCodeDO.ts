import { RequestFailure } from "@macrograph/module-opencode/Definition";
import { create, type Service } from "@macrograph/opencode-workerd";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

const configKey = "macrograph-opencode-config-v1";
const reason = (cause: unknown) =>
  cause instanceof Error && cause.message.length > 0 ? cause.message : "OpenCode request failed";

export interface Storage {
  readonly get: <T>(key: string) => Promise<T | undefined>;
  readonly put: (key: string, value: string) => Promise<void>;
}

export const makeController = (storage: Storage, make: (config: string) => Promise<Service>) => {
  let active: { readonly config: string; readonly service: Service } | undefined;
  let transition = Promise.resolve();
  const ensure = (config: string) => {
    const result = transition.then(async () => {
      if (active?.config === config) return;
      await active?.service.close();
      active = undefined;
      const service = await make(config);
      await storage.put(configKey, config);
      active = { config, service };
    });
    transition = result.catch(() => {});
    return result;
  };
  const current = () => active;
  const service = async () => {
    if (active !== undefined) return active.service;
    const persisted = await storage.get<string>(configKey);
    await ensure(persisted ?? "{}");
    const initialized = current();
    if (initialized === undefined) throw new Error("OpenCode failed to initialize");
    return initialized.service;
  };
  return { ensure, service };
};

/** Lazily owns one embedded OpenCode host and credential database per MacroGraph project. */
export default class OpenCodeDO extends Cloudflare.DurableObject<OpenCodeDO>()(
  "OpenCodeDO",
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    return Effect.sync(() => {
      const controller = makeController(state.raw.storage, (config) =>
        create(state.raw.storage, config),
      );
      const request = <A>(run: () => Promise<A>) =>
        Effect.tryPromise({
          try: run,
          catch: (cause) => new RequestFailure({ reason: reason(cause) }),
        });

      return {
        ensure: (config: string) => request(() => controller.ensure(config)),
        generateText: (input: { readonly prompt: string; readonly model: string }) =>
          request(async () => (await controller.service()).generateText(input)),
        listModels: () => request(async () => (await controller.service()).listModels()),
        listCredentials: () => request(async () => (await controller.service()).listCredentials()),
        listOAuthMethods: () =>
          request(async () => (await controller.service()).listOAuthMethods()),
        connectKey: (input: { readonly integrationID: string; readonly key: string }) =>
          request(async () => (await controller.service()).connectKey(input)),
        removeCredential: (credentialID: string) =>
          request(async () => (await controller.service()).removeCredential(credentialID)),
        startOAuth: (input: { readonly integrationID: string; readonly methodID: string }) =>
          request(async () => (await controller.service()).startOAuth(input)),
        oauthStatus: (input: { readonly integrationID: string; readonly attemptID: string }) =>
          request(async () => (await controller.service()).oauthStatus(input)),
        completeOAuth: (input: {
          readonly integrationID: string;
          readonly attemptID: string;
          readonly code: string;
        }) => request(async () => (await controller.service()).completeOAuth(input)),
        cancelOAuth: (input: { readonly integrationID: string; readonly attemptID: string }) =>
          request(async () => (await controller.service()).cancelOAuth(input)),
      };
    });
  }),
) {}
