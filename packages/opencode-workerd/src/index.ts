import { OpenCodeWorkerd } from "@opencode/sdk/workerd";

export interface CredentialSummary {
  readonly id: string;
  readonly integrationID: string;
  readonly label: string;
  readonly active: boolean;
}
export interface OAuthMethodSummary {
  readonly integrationID: string;
  readonly integrationName: string;
  readonly methodID: string;
  readonly label: string;
}
export interface OAuthAttempt {
  readonly integrationID: string;
  readonly attemptID: string;
  readonly url: string;
  readonly instructions: string;
  readonly mode: "auto" | "code";
  readonly expires: number;
}
export type OAuthStatus =
  | { readonly status: "pending" }
  | { readonly status: "complete" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "expired" };

export interface Service {
  readonly generateText: (input: {
    readonly prompt: string;
    readonly model: string;
  }) => Promise<string>;
  readonly listModels: () => Promise<ReadonlyArray<string>>;
  readonly listCredentials: () => Promise<ReadonlyArray<CredentialSummary>>;
  readonly listOAuthMethods: () => Promise<ReadonlyArray<OAuthMethodSummary>>;
  readonly connectKey: (input: {
    readonly integrationID: string;
    readonly key: string;
  }) => Promise<void>;
  readonly removeCredential: (credentialID: string) => Promise<void>;
  readonly startOAuth: (input: {
    readonly integrationID: string;
    readonly methodID: string;
  }) => Promise<OAuthAttempt>;
  readonly oauthStatus: (input: {
    readonly integrationID: string;
    readonly attemptID: string;
  }) => Promise<OAuthStatus>;
  readonly completeOAuth: (input: {
    readonly integrationID: string;
    readonly attemptID: string;
    readonly code: string;
  }) => Promise<void>;
  readonly cancelOAuth: (input: {
    readonly integrationID: string;
    readonly attemptID: string;
  }) => Promise<void>;
}

export interface Host {
  readonly generate: {
    readonly text: (input: {
      readonly prompt: string;
      readonly model?: { readonly providerID: string; readonly id: string };
    }) => Promise<{ readonly text: string }>;
  };
  readonly model: {
    readonly list: () => Promise<{
      readonly data: ReadonlyArray<{
        readonly id: string;
        readonly providerID: string;
        readonly enabled: boolean;
      }>;
    }>;
  };
  readonly credential: {
    readonly list: () => Promise<ReadonlyArray<CredentialSummary>>;
    readonly remove: (input: { readonly credentialID: string }) => Promise<void>;
  };
  readonly integration: {
    readonly list: () => Promise<{
      readonly data: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly methods: ReadonlyArray<{
          readonly type: string;
          readonly id?: string;
          readonly label?: string;
          readonly form?: ReadonlyArray<unknown>;
        }>;
      }>;
    }>;
    readonly connect: {
      readonly key: (input: {
        readonly integrationID: string;
        readonly key: string;
      }) => Promise<void>;
    };
    readonly oauth: {
      readonly connect: (input: {
        readonly integrationID: string;
        readonly methodID: string;
      }) => Promise<{
        readonly data: {
          readonly attemptID: string;
          readonly url: string;
          readonly instructions: string;
          readonly mode: "auto" | "code";
          readonly time: { readonly expires: number };
        };
      }>;
      readonly status: (input: {
        readonly integrationID: string;
        readonly attemptID: string;
      }) => Promise<{
        readonly data:
          | { readonly status: "pending" }
          | { readonly status: "complete" }
          | { readonly status: "failed"; readonly message: string }
          | { readonly status: "expired" };
      }>;
      readonly complete: (input: {
        readonly integrationID: string;
        readonly attemptID: string;
        readonly code?: string;
      }) => Promise<void>;
      readonly cancel: (input: {
        readonly integrationID: string;
        readonly attemptID: string;
      }) => Promise<void>;
    };
  };
}

const modelRef = (value: string) => {
  if (value === "") return undefined;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1)
    throw new Error("Model must use the provider/model format");
  return { providerID: value.slice(0, separator), id: value.slice(separator + 1) };
};

type Storage = Parameters<typeof OpenCodeWorkerd.create>[0]["storage"];

export const fromHost = (host: Host): Service => ({
  generateText: async ({ prompt, model }) => {
    const selected = modelRef(model);
    const result = await host.generate.text({
      prompt,
      ...(selected === undefined ? {} : { model: selected }),
    });
    return result.text;
  },
  listModels: async () => {
    const { data } = await host.model.list();
    return Array.from(
      new Set(
        data.filter((model) => model.enabled).map((model) => `${model.providerID}/${model.id}`),
      ),
    ).sort();
  },
  listCredentials: async () =>
    (await host.credential.list()).map(({ id, integrationID, label, active }) => ({
      id,
      integrationID,
      label,
      active,
    })),
  listOAuthMethods: async () =>
    (await host.integration.list()).data.flatMap((integration) =>
      integration.methods.flatMap((method) =>
        method.type === "oauth" &&
        method.id !== undefined &&
        method.label !== undefined &&
        (method.form === undefined || method.form.length === 0)
          ? [
              {
                integrationID: integration.id,
                integrationName: integration.name,
                methodID: method.id,
                label: method.label,
              },
            ]
          : [],
      ),
    ),
  connectKey: ({ integrationID, key }) => host.integration.connect.key({ integrationID, key }),
  removeCredential: (credentialID) => host.credential.remove({ credentialID }),
  startOAuth: async ({ integrationID, methodID }) => {
    const { data: attempt } = await host.integration.oauth.connect({ integrationID, methodID });
    return {
      integrationID,
      attemptID: attempt.attemptID,
      url: attempt.url,
      instructions: attempt.instructions,
      mode: attempt.mode,
      expires: attempt.time.expires,
    };
  },
  oauthStatus: async (input) => {
    const { data: status } = await host.integration.oauth.status(input);
    return status.status === "failed"
      ? { status: "failed", message: status.message }
      : { status: status.status };
  },
  completeOAuth: ({ integrationID, attemptID, code }) =>
    host.integration.oauth.complete({
      integrationID,
      attemptID,
      ...(code.trim() === "" ? {} : { code: code.trim() }),
    }),
  cancelOAuth: (input) => host.integration.oauth.cancel(input),
});

/** Creates one retained OpenCode Workerd host for a project Durable Object. */
export const create = async (storage: Storage): Promise<Service> =>
  fromHost(await OpenCodeWorkerd.create({ storage }));
