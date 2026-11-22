import type { Rpc } from "effect/rpc";

import type { ClientSettings } from "./ClientSettings.ts";

/** The default export of a module's UI entry. The host keys it by the module id it loaded. */
export interface Descriptor<View, Rpcs extends Rpc.Any = never> {
  readonly settings?: ClientSettings.Descriptor<View, Rpcs>;
}

export const make = <View, Rpcs extends Rpc.Any = never>(
  descriptor: Descriptor<View, Rpcs>,
): Descriptor<View, Rpcs> => descriptor;

export * as ModuleUI from "./ModuleUI.ts";
