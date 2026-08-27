import type { Effect } from "effect";

import type * as Engine from "./Engine.ts";
import type { PluginContext } from "./Registration.ts";

export type Plugin<Definition extends Engine.AnyDef = never> = {
  readonly id: string;
  readonly name?: string;
  readonly effect: (context: PluginContext<Definition>) => Effect.Effect<void>;
} & ([Definition] extends [never] ? { readonly engine?: never } : { readonly engine: Definition });

export type RegisterArgs<Definition extends Engine.AnyDef> =
  | readonly [plugin: Plugin<never>]
  | readonly [plugin: Plugin<Definition>, deployment: Engine.AnyDeploymentFor<Definition>];

export function make<Definition extends Engine.AnyDef>(
  plugin: Plugin<Definition>,
): Plugin<Definition>;
export function make(plugin: Plugin<never>): Plugin<never>;
export function make<Definition extends Engine.AnyDef>(plugin: Plugin<Definition> | Plugin<never>) {
  return plugin;
}
