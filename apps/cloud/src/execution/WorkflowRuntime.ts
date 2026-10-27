import type { Project } from "@macrograph/core";
import type { Instances as OpenCodeInstances } from "@macrograph/module-opencode/Instance";

import * as Executor from "@macrograph/execution/Executor";
import { RequestFailure as OpenCodeFailure } from "@macrograph/module-opencode/Definition";
import { Effect } from "effect";

import * as CloudModules from "../modules/CloudModules.ts";

const unavailableOpenCode: OpenCodeInstances = {
  connectionTypes: ["managed", "remote"],
  resolve: () => Effect.fail(new OpenCodeFailure({ reason: "OpenCode runtime is unavailable" })),
};

/** Runtime clients for every module with a workflow client, keyed by module id. */
export const make = Effect.fnUntraced(function* (
  project: Project.Model,
  openCodeInstances: OpenCodeInstances = unavailableOpenCode,
) {
  const input = { project, openCode: openCodeInstances };
  const clients = new Map<string, unknown>();
  for (const module of CloudModules.modules)
    if (module.workflow !== undefined) clients.set(module.id, yield* module.workflow(input));

  const engineClient: NonNullable<Executor.MakeOptions["engineClient"]> = (moduleId) =>
    Effect.succeed(
      clients.has(moduleId)
        ? clients.get(moduleId)
        : new Proxy(
            {},
            {
              get: () => () => Effect.fail(new Executor.EngineClientUnavailable({ moduleId })),
            },
          ),
    );
  return engineClient;
});
