import type { ModuleCatalog } from "@macrograph/module/ModuleCatalog";
import type { ModuleId } from "@macrograph/module/ModuleId";
import type { Rpc } from "effect/rpc";

import {
  ModuleNotFound,
  NotUninstallable,
  type ModuleAdminRpc,
} from "@macrograph/module/ModuleAdminRpc";
import { Effect } from "effect";

import type { Installer } from "./Installer.ts";
import type { InstallRecords } from "./InstallRecords.ts";

/**
 * What the handlers need from the module host. The installer only manages files and records;
 * loading, unloading and the catalog belong to the host.
 */
export interface Host {
  /** Load (or reload) a module after its installed copy changed, returning its catalog entry. */
  readonly installed: (
    id: ModuleId.Id,
    record: InstallRecords.Record,
    path: string,
  ) => Effect.Effect<ModuleCatalog.Entry>;
  /** Unload a module whose installed copy was removed; a shipped built-in reverts to its shipped copy. */
  readonly uninstalled: (id: ModuleId.Id) => Effect.Effect<void>;
  /** The current catalog, with installer statuses merged in (see `ModuleStatus.applyToEntry`). */
  readonly catalog: Effect.Effect<ModuleCatalog.Catalog>;
  /** Whether a module is a shipped built-in, which can't be uninstalled. */
  readonly isShipped: (id: ModuleId.Id) => Effect.Effect<boolean>;
}

/** The authenticated admin making the call. */
export interface Caller {
  readonly actor: string;
}

type Payload<Tag extends ModuleAdminRpc.ModuleAdminRpcs["_tag"]> = Rpc.Payload<
  Rpc.ExtractTag<ModuleAdminRpc.ModuleAdminRpcs, Tag>
>;

/**
 * Handler functions for the registry and install admin RPCs, returning the `ModuleAdminRpcs`
 * payload schemas. The server checks `requiresAdmin` before calling them.
 */
export const make = (installer: Installer.Interface, host: Host) => {
  const afterInstall = (id: ModuleId.Id, result: Installer.InstallResult) =>
    Effect.gen(function* () {
      const entry = yield* host.installed(id, result.record, result.path);
      if (result.changed) yield* installer.prune(id);
      return entry;
    });

  return {
    ListRegistries: (_: Payload<"ListRegistries">) => installer.listRegistries,
    AddRegistry: ({ url }: Payload<"AddRegistry">) => installer.addRegistry(url),
    RemoveRegistry: ({ namespace }: Payload<"RemoveRegistry">) =>
      installer.removeRegistry(namespace),
    SetRegistryTrusted: ({ namespace, trusted }: Payload<"SetRegistryTrusted">) =>
      installer.setRegistryTrusted(namespace, trusted),
    SearchRegistry: (payload: Payload<"SearchRegistry">) => installer.search(payload),
    GetRegistryPackage: ({ id }: Payload<"GetRegistryPackage">) => installer.getPackage(id),
    InstallModule: (payload: Payload<"InstallModule">, caller: Caller) =>
      installer
        .install({ ...payload, actor: caller.actor })
        .pipe(Effect.flatMap((result) => afterInstall(payload.id, result))),
    UpdateModule: (payload: Payload<"UpdateModule">, caller: Caller) =>
      installer
        .update({ ...payload, actor: caller.actor })
        .pipe(Effect.flatMap((result) => afterInstall(payload.id, result))),
    UninstallModule: ({ id }: Payload<"UninstallModule">) =>
      installer.uninstall(id).pipe(
        Effect.andThen(host.uninstalled(id)),
        Effect.catchTag("ModuleNotFound", () =>
          Effect.flatMap(
            host.isShipped(id),
            (shipped): Effect.Effect<never, ModuleNotFound | NotUninstallable> =>
              shipped
                ? Effect.fail(
                    new NotUninstallable({ id, reason: "Built-in modules can only be disabled" }),
                  )
                : Effect.fail(new ModuleNotFound({ id })),
          ),
        ),
      ),
    CheckForUpdates: (_: Payload<"CheckForUpdates">) =>
      installer.checkForUpdates.pipe(Effect.andThen(host.catalog)),
  };
};

export type Handlers = ReturnType<typeof make>;

export * as AdminHandlers from "./AdminHandlers.ts";
