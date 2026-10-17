import { OpenCode } from "@opencode/client";
import { Config } from "@opencode/schema/config";
import { OpenCodeWorkerd } from "@opencode/sdk/workerd";
import { Schema } from "effect";

export interface CredentialSummary {
  readonly id: string;
  readonly integrationID: string;
  readonly label: string;
  readonly active: boolean;
}

export interface Service {
  readonly generateText: (input: {
    readonly prompt: string;
    readonly model: string;
  }) => Promise<string>;
  readonly listModels: () => Promise<ReadonlyArray<string>>;
  readonly listCredentials: () => Promise<ReadonlyArray<CredentialSummary>>;
  readonly connectKey: (input: {
    readonly integrationID: string;
    readonly key: string;
  }) => Promise<void>;
  readonly removeCredential: (credentialID: string) => Promise<void>;
  readonly close: () => Promise<void>;
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
    readonly connect: {
      readonly key: (input: {
        readonly integrationID: string;
        readonly key: string;
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
  connectKey: ({ integrationID, key }) => host.integration.connect.key({ integrationID, key }),
  removeCredential: (credentialID) => host.credential.remove({ credentialID }),
  close: () => Promise.resolve(),
});

export const decodeConfig = async (input: string) => {
  const parsed: unknown = JSON.parse(input);
  const decoded = await Schema.decodeUnknownPromise(Config.Info)(parsed, {
    onExcessProperty: "error",
  });
  return Schema.encodeUnknownPromise(Config.Info)(decoded);
};

/** Creates one retained OpenCode Workerd host for a project Durable Object. */
export const create = async (storage: Storage, configText: string): Promise<Service> => {
  const host = await OpenCodeWorkerd.create({ storage, config: await decodeConfig(configText) });
  return { ...fromHost(host), close: () => host.close() };
};

/** Connects to an external OpenCode service without provisioning local state. */
export const connectRemote = async (input: {
  readonly url: string;
  readonly password: string;
}): Promise<Service> => {
  const client = OpenCode.make({
    baseUrl: input.url,
    headers:
      input.password === ""
        ? undefined
        : { authorization: `Basic ${btoa(`opencode:${input.password}`)}` },
  });
  await client.server.info();
  return fromHost(client);
};
