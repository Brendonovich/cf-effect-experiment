import type { ModuleId } from "@macrograph/module";

import { createContext, useContext } from "solid-js";

import type { ModuleAdminClient } from "./client.ts";

export interface InstallRequest {
  readonly kind: "install" | "update";
  readonly id: ModuleId.Id;
  readonly version?: string;
  /**
   * Set when the release is already known to be untrusted, so the confirmation
   * opens before contacting the server. The server enforces confirmation
   * either way and answers with `UntrustedConfirmationRequired`.
   */
  readonly untrusted?: {
    readonly version: string;
    readonly requires: ReadonlyArray<string>;
    readonly node: ReadonlyArray<string>;
    readonly native: ReadonlyArray<string>;
  };
}

export interface ModulesAdminContextValue {
  readonly client: () => ModuleAdminClient;
  readonly requestInstall: (request: InstallRequest) => void;
  /** The install or update currently running for a module, if any. */
  readonly installing: (id: ModuleId.Id) => InstallRequest["kind"] | null;
}

export const ModulesAdminContext = createContext<ModulesAdminContextValue>();

export const useModulesAdmin = () => useContext(ModulesAdminContext);
