import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { Effect, Layer } from "effect";

import { ClientRpcs, OpenCodeEngine, RequestFailure, RuntimeRpcs } from "../Definition.ts";

interface Client {
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

export type Connect = () => Promise<Client | undefined>;

const localClient: Connect = async () => {
  const endpoint = await Service.discover();
  if (endpoint === undefined) return undefined;
  const service =
    endpoint.auth === undefined ? { url: endpoint.url } : { url: endpoint.url, auth: endpoint.auth };
  return OpenCode.make({
    baseUrl: endpoint.url,
    headers: Service.headers(service),
  });
};

const reason = (cause: unknown) =>
  cause instanceof Error && cause.message.length > 0 ? cause.message : "OpenCode request failed";

const parseModel = (value: string) => {
  if (value === "") return Effect.succeed(undefined);
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1)
    return Effect.fail(new RequestFailure({ reason: "Model must use the provider/model format" }));
  return Effect.succeed({ providerID: value.slice(0, separator), id: value.slice(separator + 1) });
};

export const makeLayer = (connect: Connect = localClient) =>
  OpenCodeEngine.toLayer(() => {
    const withClient = <A>(run: (client: Client) => Promise<A>) =>
      Effect.tryPromise({
        try: async () => {
          const client = await connect();
          if (client === undefined)
            throw new Error("No running local OpenCode service was discovered");
          return run(client);
        },
        catch: (cause) => new RequestFailure({ reason: reason(cause) }),
      });

    return Effect.succeed(
      OpenCodeEngine.of({
        resources: Layer.empty,
        rpcs: RuntimeRpcs.toLayer({
          OpenCodeGenerateText: Effect.fnUntraced(function* ({ prompt, model }) {
            const selected = yield* parseModel(model);
            const result = yield* withClient((client) =>
              client.generate.text({
                prompt,
                ...(selected === undefined ? {} : { model: selected }),
              }),
            );
            return result.text;
          }),
          OpenCodeListModels: () =>
            withClient((client) => client.model.list()).pipe(
              Effect.map(({ data }) =>
                Array.from(
                  new Set(
                    data
                      .filter((model) => model.enabled)
                      .map((model) => `${model.providerID}/${model.id}`),
                  ),
                ).sort(),
              ),
            ),
        }),
        client: { state: Effect.succeed({}), rpcs: ClientRpcs.toLayer({}) },
      }),
    );
  });

export const layer = makeLayer();
export default layer;
