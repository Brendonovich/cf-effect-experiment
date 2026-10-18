import { Effect } from "effect";

import type { Instance } from "./Instance.ts";

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

const reason = (cause: unknown) =>
  typeof cause === "object" &&
  cause !== null &&
  "reason" in cause &&
  typeof cause.reason === "string"
    ? cause.reason
    : cause instanceof Error && cause.message.length > 0
      ? cause.message
      : "OpenCode request failed";

const request = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new RequestFailure({ reason: reason(cause) }),
  });

export const fromClient = (client: Client): Instance => ({
  generateText: ({ prompt, model }) =>
    Effect.gen(function* () {
      let selected: { readonly providerID: string; readonly id: string } | undefined;
      if (model !== "") {
        const separator = model.indexOf("/");
        if (separator <= 0 || separator === model.length - 1)
          return yield* new RequestFailure({ reason: "Model must use the provider/model format" });
        selected = { providerID: model.slice(0, separator), id: model.slice(separator + 1) };
      }
      return yield* request(() =>
        client.generate.text({
          prompt,
          ...(selected === undefined ? {} : { model: selected }),
        }),
      ).pipe(Effect.map(({ text }) => text));
    }),
  listModels: request(() => client.model.list()).pipe(
    Effect.map(({ data }) =>
      Array.from(
        new Set(
          data.filter((model) => model.enabled).map((model) => `${model.providerID}/${model.id}`),
        ),
      ).sort(),
    ),
  ),
});
