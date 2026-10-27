import type { Effect } from "effect";

import type * as t from "./DataType.ts";
import type * as Engine from "./Engine.ts";
import type { ModuleContext } from "./Registration.ts";

import * as ModuleId from "./ModuleId.ts";

/**
 * A module definition. It never names its own id: the host supplies the id when it loads the
 * module (see `identify`), so the same build can be loaded under different namespaces.
 */
export type Module<Definition extends Engine.AnyDef = never> = {
  readonly name?: string;
  readonly description?: string;
  /** Types this module defines, keyed by ids local to the module. Hosts scope them to the module id. */
  readonly types?: t.Definitions;
  readonly effect: (context: ModuleContext<Definition>) => Effect.Effect<void>;
} & ([Definition] extends [never] ? { readonly engine?: never } : { readonly engine: Definition });

/** A module paired with the id its host loaded it under. */
export type Identified<Definition extends Engine.AnyDef = never> = Module<Definition> & {
  readonly id: ModuleId.Id;
};

export type RegisterArgs<Definition extends Engine.AnyDef> =
  | readonly [module: Identified<never>]
  | readonly [module: Identified<Definition>, deployment: Engine.AnyDeploymentFor<Definition>];

export function make<Definition extends Engine.AnyDef>(
  module: Module<Definition>,
): Module<Definition>;
export function make(module: Module<never>): Module<never>;
export function make<Definition extends Engine.AnyDef>(module: Module<Definition> | Module<never>) {
  return module;
}

/** Pairs a module with the id its host loads it under. */
export const identify = <Definition extends Engine.AnyDef = never>(
  id: ModuleId.Id,
  module: Module<Definition>,
): Identified<Definition> => ({ ...module, id });

/** Publisher of the modules that ship with MacroGraph. */
export const BuiltinPublisher = "macrograph";

/** The id a built-in module is loaded under, e.g. `builtinId("twitch")`. */
export const builtinId = (name: string): ModuleId.Id =>
  ModuleId.make({ namespace: ModuleId.OfficialNamespace, publisher: BuiltinPublisher, name });

/** Built-in module packages are named `@macrograph/module-<name>`. */
export const builtinIdFromPackage = (packageName: string): ModuleId.Id =>
  builtinId(packageName.replace(/^@[^/]+\//, "").replace(/^module-/, ""));

export const displayName = (module: { readonly id: ModuleId.Id; readonly name?: string }) =>
  module.name ?? ModuleId.toDisplay(module.id);
