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
  readonly credential: {
    readonly list: () => Promise<
      ReadonlyArray<{
        readonly id: string;
        readonly integrationID: string;
        readonly label: string;
        readonly active: boolean;
      }>
    >;
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
          readonly form?: ReadonlyArray<object>;
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
  listCredentials: request(() => client.credential.list()).pipe(
    Effect.map((credentials) =>
      credentials.map(({ id, integrationID, label, active }) => ({
        id,
        integrationID,
        label,
        active,
      })),
    ),
  ),
  listOAuthMethods: request(() => client.integration.list()).pipe(
    Effect.map(({ data }) =>
      data.flatMap((integration) =>
        integration.methods.flatMap((method) =>
          method.type === "oauth" &&
          method.id !== undefined &&
          method.label !== undefined &&
          // Hidden fields carry defaults (e.g. the OpenCode Console server), so no input is needed.
          (method.form ?? []).every((field) => "hidden" in field && field.hidden === true)
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
    ),
  ),
  connectKey: (input) => request(() => client.integration.connect.key(input)),
  removeCredential: (credentialID) => request(() => client.credential.remove({ credentialID })),
  startOAuth: ({ integrationID, methodID }) =>
    request(() => client.integration.oauth.connect({ integrationID, methodID })).pipe(
      Effect.map(({ data }) => ({
        integrationID,
        attemptID: data.attemptID,
        url: data.url,
        instructions: data.instructions,
        mode: data.mode,
        expires: data.time.expires,
      })),
    ),
  oauthStatus: (input) =>
    request(() => client.integration.oauth.status(input)).pipe(
      Effect.map(({ data }) =>
        data.status === "failed"
          ? { status: "failed" as const, message: data.message }
          : { status: data.status },
      ),
    ),
  completeOAuth: ({ integrationID, attemptID, code }) =>
    request(() =>
      client.integration.oauth.complete({
        integrationID,
        attemptID,
        ...(code.trim() === "" ? {} : { code: code.trim() }),
      }),
    ),
  cancelOAuth: (input) => request(() => client.integration.oauth.cancel(input)),
});
