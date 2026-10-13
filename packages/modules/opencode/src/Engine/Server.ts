import { OpenCode } from "@opencode/client";
import { Service } from "@opencode/client/service";
import { Effect, Layer } from "effect";

import { type Client, generateText, listModels } from "../Client.ts";
import { ClientRpcs, OpenCodeEngine, RequestFailure, RuntimeRpcs } from "../Definition.ts";

export type Connect = () => Promise<Client | undefined>;

const localClient: Connect = async () => {
  const endpoint = await Service.discover();
  if (endpoint === undefined) return undefined;
  const service =
    endpoint.auth === undefined
      ? { url: endpoint.url }
      : { url: endpoint.url, auth: endpoint.auth };
  return OpenCode.make({
    baseUrl: endpoint.url,
    headers: Service.headers(service),
  });
};

const reason = (cause: unknown) =>
  typeof cause === "object" &&
  cause !== null &&
  "reason" in cause &&
  typeof cause.reason === "string"
    ? cause.reason
    : cause instanceof Error && cause.message.length > 0
      ? cause.message
      : "OpenCode request failed";

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
          OpenCodeGenerateText: (input) => withClient((client) => generateText(client, input)),
          OpenCodeListModels: () => withClient(listModels),
        }),
        client: {
          state: Effect.succeed({ mode: "server", credentials: [] }),
          rpcs: ClientRpcs.toLayer({
            OpenCodeConnectKey: () =>
              Effect.fail(
                new RequestFailure({
                  reason: "Manage credentials through the local OpenCode service",
                }),
              ),
            OpenCodeRemoveCredential: () =>
              Effect.fail(
                new RequestFailure({
                  reason: "Manage credentials through the local OpenCode service",
                }),
              ),
          }),
        },
      }),
    );
  });

export const layer = makeLayer();
export default layer;
