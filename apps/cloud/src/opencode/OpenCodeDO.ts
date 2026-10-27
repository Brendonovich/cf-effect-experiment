import type { Service } from "@macrograph/opencode-workerd";

import * as Cloudflare from "@alchemy.run/cloudflare";
import { describeFailure, RequestFailure } from "@macrograph/module-opencode/Definition";
import { Effect } from "effect";

const configKey = "macrograph-opencode-config-v1";

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
  const current = async () => {
    if (active !== undefined) return active;
    const persisted = await storage.get<string>(configKey);
    await ensure(persisted ?? "{}");
    if (active === undefined) throw new Error("OpenCode failed to initialize");
    return active;
  };
  /** Starts the instance with its applied config, or with `initial` when it was never provisioned. */
  const provision = async (initial: string) => {
    if (active === undefined && (await storage.get<string>(configKey)) === undefined)
      await ensure(initial);
    return (await current()).config;
  };
  const service = async () => (await current()).service;
  return { ensure, provision, service };
};

export interface OpenCodeDOShape {
  /** Applies a config, restarting the embedded host when it changed. */
  readonly ensure: (config: string) => Effect.Effect<void, RequestFailure>;
  /** Starts the host without applying config changes; returns the config it runs. */
  readonly provision: (initialConfig: string) => Effect.Effect<string, RequestFailure>;
  readonly generateText: (input: {
    readonly prompt: string;
    readonly model: string;
  }) => Effect.Effect<string, RequestFailure>;
  readonly listModels: () => Effect.Effect<ReadonlyArray<string>, RequestFailure>;
  readonly listCredentials: () => Effect.Effect<
    ReadonlyArray<{
      readonly id: string;
      readonly integrationID: string;
      readonly label: string;
      readonly active: boolean;
    }>,
    RequestFailure
  >;
  readonly listOAuthMethods: () => Effect.Effect<
    ReadonlyArray<{
      readonly integrationID: string;
      readonly integrationName: string;
      readonly methodID: string;
      readonly label: string;
    }>,
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
  }) => Effect.Effect<
    {
      readonly integrationID: string;
      readonly attemptID: string;
      readonly url: string;
      readonly instructions: string;
      readonly mode: "auto" | "code";
      readonly expires: number;
    },
    RequestFailure
  >;
  readonly oauthStatus: (input: {
    readonly integrationID: string;
    readonly attemptID: string;
  }) => Effect.Effect<
    | { readonly status: "pending" }
    | { readonly status: "complete" }
    | { readonly status: "failed"; readonly message: string }
    | { readonly status: "expired" },
    RequestFailure
  >;
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

/**
 * Owns one managed OpenCode connection: an embedded OpenCode host and its credential database.
 * Hosted by the production (ingress) worker; the editor binds to the same namespace.
 */
export default class OpenCodeDO extends Cloudflare.DurableObject<OpenCodeDO, OpenCodeDOShape>()(
  "OpenCodeDO",
) {}

export const OpenCodeDOLayer = OpenCodeDO.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    return Effect.sync((): OpenCodeDOShape => {
      // The embedded OpenCode runtime is large; load it on first use so it doesn't count toward
      // the hosting worker's startup CPU limit.
      const controller = makeController(state.raw.storage, (config) =>
        import("@macrograph/opencode-workerd").then(({ create }) =>
          create(state.raw.storage, config),
        ),
      );
      const request = <A>(run: () => Promise<A>) =>
        Effect.tryPromise({
          try: run,
          catch: (cause) => new RequestFailure({ reason: describeFailure(cause) }),
        });

      return {
        ensure: (config) => request(() => controller.ensure(config)),
        provision: (initialConfig) => request(() => controller.provision(initialConfig)),
        generateText: (input) =>
          request(async () => (await controller.service()).generateText(input)),
        listModels: () => request(async () => (await controller.service()).listModels()),
        listCredentials: () => request(async () => (await controller.service()).listCredentials()),
        listOAuthMethods: () =>
          request(async () => (await controller.service()).listOAuthMethods()),
        connectKey: (input) => request(async () => (await controller.service()).connectKey(input)),
        removeCredential: (credentialID) =>
          request(async () => (await controller.service()).removeCredential(credentialID)),
        startOAuth: (input) => request(async () => (await controller.service()).startOAuth(input)),
        oauthStatus: (input) =>
          request(async () => (await controller.service()).oauthStatus(input)),
        completeOAuth: (input) =>
          request(async () => (await controller.service()).completeOAuth(input)),
        cancelOAuth: (input) =>
          request(async () => (await controller.service()).cancelOAuth(input)),
      };
    });
  }),
);
