import type { RpcClient, RpcClientError } from "effect/rpc";

import { EditorAccess } from "@macrograph/editor";
import { ModuleAdminRpc, type ModuleCatalog, ModuleId } from "@macrograph/module";
import { Effect } from "effect";

/**
 * A client for the server's `ModuleAdminRpcs` group. Hosts authorize it with the editor connection
 * middleware, which can reject a call with `EditorAccess.Forbidden`.
 */
export type ModuleAdminClient = RpcClient.FromGroup<
  typeof ModuleAdminRpc.ModuleAdminRpcs,
  RpcClientError.RpcClientError | EditorAccess.Forbidden
>;

/**
 * Subscribes to the editor's `ModulesChanged` event. Returns a function that
 * stops the subscription.
 */
export type SubscribeModulesChanged = (
  listener: (event: ModuleAdminRpc.ModulesChanged) => void,
) => () => void;

export const queryKeys = {
  all: ["modules-admin"] as const,
  modules: ["modules-admin", "modules"] as const,
  registries: ["modules-admin", "registries"] as const,
  search: (namespace: string | undefined, query: string) =>
    ["modules-admin", "search", namespace ?? null, query] as const,
  registryPackage: (id: ModuleId.Id) => ["modules-admin", "package", id] as const,
};

/** Runs an admin RPC, rejecting with the RPC's typed error. */
export const run = <A, E>(effect: Effect.Effect<A, E>): Promise<A> => Effect.runPromise(effect);

export const isUntrustedConfirmationRequired = (
  error: unknown,
): error is ModuleAdminRpc.UntrustedConfirmationRequired =>
  error instanceof ModuleAdminRpc.UntrustedConfirmationRequired;

const display = (id: string) => {
  const parsed = ModuleId.parse(id);
  return parsed._tag === "Some" ? ModuleId.toDisplay(parsed.value) : id;
};

/** A message a person can act on for any admin RPC failure. */
export const describeError = (error: unknown): string => {
  if (error instanceof EditorAccess.Forbidden)
    return "Only server administrators can manage modules.";
  if (error instanceof ModuleAdminRpc.ModuleNotFound)
    return `Module ${display(error.id)} was not found.`;
  if (error instanceof ModuleAdminRpc.ModuleNotLoaded)
    return `Module ${display(error.id)} isn't loaded (${error.status})${error.error ? `: ${error.error}` : "."}`;
  if (error instanceof ModuleAdminRpc.UntrustedConfirmationRequired)
    return `${display(error.id)} ${error.version} is untrusted and needs confirmation before it can be installed.`;
  if (error instanceof ModuleAdminRpc.IncompatibleModule)
    return `${display(error.id)} ${error.version} needs module API ${error.api}, but this server supports ${error.supported.join(", ")}.`;
  if (error instanceof ModuleAdminRpc.ReleaseNotFound)
    return `No release${error.version ? ` ${error.version}` : ""} of ${display(error.id)} was found.`;
  if (error instanceof ModuleAdminRpc.ReleaseUnavailable)
    return `${display(error.id)} ${error.version} was ${error.status}${error.reason ? `: ${error.reason}` : "."}`;
  if (error instanceof ModuleAdminRpc.VerificationFailed)
    return `${display(error.id)} ${error.version} failed its ${error.check} check: ${error.message}`;
  if (error instanceof ModuleAdminRpc.InstallFailed)
    return `Installing ${display(error.id)} failed: ${error.message}`;
  if (error instanceof ModuleAdminRpc.NotUninstallable)
    return `${display(error.id)} can't be uninstalled: ${error.reason}`;
  if (error instanceof ModuleAdminRpc.RegistryNotFound)
    return `Registry ${error.namespace} was not found.`;
  if (error instanceof ModuleAdminRpc.RegistryConflict)
    return `Registry ${error.namespace} is already added from ${error.url}.`;
  if (error instanceof ModuleAdminRpc.RegistryError)
    return `Registry error${error.namespace ? ` (${error.namespace})` : ""}: ${error.message}`;
  if (error instanceof ModuleAdminRpc.InvalidLink)
    return `Can't link ${error.path}: ${error.message}`;
  if (error instanceof Error && error.message) return error.message;
  return "The module operation failed.";
};

export const sourceLabels: Record<ModuleCatalog.SourceKind, string> = {
  shipped: "Built-in",
  installed: "Installed",
  local: "Local",
  linked: "Linked",
};

export const statusLabels: Record<ModuleCatalog.Status, string> = {
  discovered: "Discovered",
  loading: "Loading",
  loaded: "Loaded",
  failed: "Failed",
  disabled: "Disabled",
};
