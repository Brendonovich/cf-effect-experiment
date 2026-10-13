import { RequestFailure } from "./Definition.ts";

export interface Client {
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
}

const parseModel = (value: string) => {
  if (value === "") return undefined;
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1)
    throw new RequestFailure({ reason: "Model must use the provider/model format" });
  return { providerID: value.slice(0, separator), id: value.slice(separator + 1) };
};

export const generateText = async (
  client: Client,
  input: { readonly prompt: string; readonly model: string },
) => {
  const model = parseModel(input.model);
  const result = await client.generate.text({
    prompt: input.prompt,
    ...(model === undefined ? {} : { model }),
  });
  return result.text;
};

export const listModels = async (client: Client) => {
  const { data } = await client.model.list();
  return Array.from(
    new Set(
      data.filter((model) => model.enabled).map((model) => `${model.providerID}/${model.id}`),
    ),
  ).sort();
};
