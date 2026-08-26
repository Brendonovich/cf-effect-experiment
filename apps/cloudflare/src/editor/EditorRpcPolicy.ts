import type { CurrentUser, ProjectNotFound } from "@macrograph/cloud-api";

import { Policy } from "@macrograph/core";
import { Context, Effect, Layer } from "effect";

import * as ProjectPolicy from "../project/ProjectPolicy.ts";

export class Service extends Context.Service<
  Service,
  {
    readonly canView: (projectId: string) => Policy.Policy<ProjectNotFound, CurrentUser>;
  }
>()("macrograph/cloudflare/EditorRpcPolicy") {}

export const layer = Layer.effect(Service)(
  Effect.gen(function* () {
    const projectPolicy = yield* ProjectPolicy.Service;
    return {
      canView: projectPolicy.canView,
    };
  }),
);
