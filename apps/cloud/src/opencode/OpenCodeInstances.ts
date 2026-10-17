import type { Instance, Instances } from "@macrograph/module-opencode/Instance";

import { RequestFailure } from "@macrograph/module-opencode/Definition";
import { connectRemote, type Service } from "@macrograph/opencode-workerd";
import { Effect } from "effect";

export interface Namespace {
  readonly getByName: (name: string) => {
    readonly ensure: (config: string) => Effect.Effect<void, unknown>;
    readonly generateText: (input: {
      readonly prompt: string;
      readonly model: string;
    }) => Effect.Effect<string, unknown>;
    readonly listModels: () => Effect.Effect<ReadonlyArray<string>, unknown>;
  };
}

const failure = (cause: unknown) =>
  new RequestFailure({
    reason:
      cause instanceof Error && cause.message.length > 0
        ? cause.message
        : "OpenCode request failed",
  });

const remoteInstance = (service: Service): Instance => ({
  generateText: (input) =>
    Effect.tryPromise({ try: () => service.generateText(input), catch: failure }),
  listModels: Effect.tryPromise({ try: () => service.listModels(), catch: failure }),
});

export const make = (
  projectId: Effect.Effect<string, RequestFailure>,
  namespace: Namespace,
  connect: typeof connectRemote = connectRemote,
): Instances => ({
  defaultTarget: "managed",
  availableTargets: ["managed", "remote"],
  resolve: (target) => {
    if (target.type === "remote")
      return Effect.tryPromise({
        try: () => connect({ url: target.url, password: target.password }),
        catch: failure,
      }).pipe(Effect.map(remoteInstance));
    const config = target.type === "managed" ? target.config : "{}";
    return projectId.pipe(
      Effect.map((id) => namespace.getByName(id)),
      Effect.tap((stub) => stub.ensure(config).pipe(Effect.mapError(failure))),
      Effect.map(
        (stub): Instance => ({
          generateText: (input) => stub.generateText(input).pipe(Effect.mapError(failure)),
          listModels: stub.listModels().pipe(Effect.mapError(failure)),
        }),
      ),
    );
  },
});
