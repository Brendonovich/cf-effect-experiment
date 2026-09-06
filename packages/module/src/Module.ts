import type { Effect } from "effect";

import type * as Engine from "./Engine.ts";
import type { ModuleContext } from "./Registration.ts";

export type Module<Definition extends Engine.AnyDef = never> = {
  readonly id: string;
  readonly name?: string;
  readonly effect: (context: ModuleContext<Definition>) => Effect.Effect<void>;
} & ([Definition] extends [never] ? { readonly engine?: never } : { readonly engine: Definition });

export type RegisterArgs<Definition extends Engine.AnyDef> =
  | readonly [module: Module<never>]
  | readonly [module: Module<Definition>, deployment: Engine.AnyDeploymentFor<Definition>];

export function make<Definition extends Engine.AnyDef>(
  module: Module<Definition>,
): Module<Definition>;
export function make(module: Module<never>): Module<never>;
export function make<Definition extends Engine.AnyDef>(module: Module<Definition> | Module<never>) {
  return module;
}
