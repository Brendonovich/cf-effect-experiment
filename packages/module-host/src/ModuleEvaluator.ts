import type { Manifest } from "@macrograph/module/Manifest";
import type { ModuleCatalog } from "@macrograph/module/ModuleCatalog";
import type { ModuleId } from "@macrograph/module/ModuleId";

import { Context, Effect, Layer } from "effect";

import { VmLoader } from "./VmLoader.ts";

export interface Input {
  readonly id: ModuleId.Id;
  readonly source: ModuleCatalog.SourceKind;
  readonly root: string;
  readonly manifest: Manifest.Model;
}

/**
 * Turns a module folder into its server entry's default export. Production uses the `vm`
 * loader. Dev hosts can provide their own implementation, e.g. importing built-ins from source
 * through Vite's server runner, and delegate everything else to `VmLoader.evaluate`.
 */
export class Service extends Context.Service<
  Service,
  {
    readonly evaluate: (input: Input) => Effect.Effect<unknown, VmLoader.EvaluateError>;
  }
>()("@macrograph/module-host/ModuleEvaluator") {}

export const vm = Layer.succeed(Service, { evaluate: VmLoader.evaluate });

export * as ModuleEvaluator from "./ModuleEvaluator.ts";
