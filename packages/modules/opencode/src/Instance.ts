import { Effect } from "effect";

import type { GenerateTextRequest, RequestFailure, Target, TargetType } from "./Definition.ts";

export interface Instance {
  readonly generateText: (
    input: typeof GenerateTextRequest.Type,
  ) => Effect.Effect<string, RequestFailure>;
  readonly listModels: Effect.Effect<ReadonlyArray<string>, RequestFailure>;
}

/** Resolves logical OpenCode targets without exposing platform provisioning details. */
export interface Instances {
  readonly defaultTarget: TargetType;
  readonly availableTargets: ReadonlyArray<TargetType>;
  readonly resolve: (target: Target) => Effect.Effect<Instance, RequestFailure>;
}
