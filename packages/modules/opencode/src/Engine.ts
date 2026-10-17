import { Effect, Layer } from "effect";

import type { Instances } from "./Instance.ts";

import {
  ClientRpcs,
  OpenCodeEngine,
  RequestFailure,
  RuntimeRpcs,
  type Target,
} from "./Definition.ts";

const summary = (target: Target) =>
  target.type === "remote" ? { type: "remote" as const, url: target.url } : { type: target.type };

export const makeLayer = (instances: Instances) =>
  OpenCodeEngine.toLayer((context) => {
    const resolve = context.storage.get.pipe(
      Effect.flatMap(({ target }) => instances.resolve(target)),
    );
    return Effect.succeed(
      OpenCodeEngine.of({
        resources: Layer.empty,
        rpcs: RuntimeRpcs.toLayer({
          OpenCodeGenerateText: (input) =>
            resolve.pipe(Effect.flatMap((instance) => instance.generateText(input))),
          OpenCodeListModels: () => resolve.pipe(Effect.flatMap((instance) => instance.listModels)),
        }),
        client: {
          state: context.storage.get.pipe(
            Effect.map(({ target }) => ({
              target: summary(target),
              defaultTarget: instances.defaultTarget,
              availableTargets: instances.availableTargets,
            })),
          ),
          rpcs: ClientRpcs.toLayer({
            OpenCodeSetTarget: (target) => {
              const supported =
                target.type === "default" || instances.availableTargets.includes(target.type);
              if (!supported)
                return Effect.fail(
                  new RequestFailure({
                    reason: `${target.type} OpenCode targets are unavailable in this deployment`,
                  }),
                );
              return instances
                .resolve(target)
                .pipe(
                  Effect.andThen(context.storage.set({ target })),
                  Effect.andThen(context.client.refresh),
                );
            },
          }),
        },
      }),
    );
  });
