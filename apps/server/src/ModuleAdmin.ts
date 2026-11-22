import type { ModuleCatalog } from "@macrograph/module/ModuleCatalog";

import { EditorAccess, EditorEvents, EditorRpc } from "@macrograph/editor";
import { ModuleRegistry } from "@macrograph/module-host/ModuleRegistry";
import { ModuleTrust } from "@macrograph/module-host/ModuleTrust";
import { AdminHandlers } from "@macrograph/module-installer/AdminHandlers";
import { Installer } from "@macrograph/module-installer/Installer";
import { ModuleAdminRpc } from "@macrograph/module/ModuleAdminRpc";
import { ModuleId } from "@macrograph/module/ModuleId";
import { Duration, Effect, Layer, Option, Stream } from "effect";

/** Module admin RPCs, authorized by the editor connection policy like every other editor RPC. */
export const Rpcs = ModuleAdminRpc.ModuleAdminRpcs.middleware(EditorRpc.ConnectionMiddleware);

/** Trust and registry flags for installed copies, from the installer's records and checks. */
export const trustLayer = Layer.effect(ModuleTrust.Service)(
  Effect.map(Installer.Service, (installer) =>
    ModuleTrust.Service.of({
      lookup: (input) =>
        Effect.map(installer.statuses, (statuses) => {
          const status = statuses.get(input.id);
          if (
            status === undefined ||
            input.source !== "installed" ||
            status.version !== input.version
          )
            return ModuleTrust.unknown;
          return {
            trust: Option.some(status.trust),
            revoked: status.flags.revoked,
            updateAvailable: status.flags.updateAvailable,
          };
        }),
    }),
  ),
);

/**
 * Server-lifetime background work: registry checks, feeding installer statuses back into the
 * registry, and broadcasting `ModulesChanged` to editors whenever the registry changes.
 */
export const backgroundLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const installer = yield* Installer.Service;
    const registry = yield* ModuleRegistry.Service;
    const events = yield* EditorEvents.Service;
    yield* installer.scheduleChecks();
    // `changes` streams start with the current value; skip it only if nothing changed before the
    // forked fiber subscribed.
    const statuses = yield* installer.statuses;
    yield* installer.statusChanges.pipe(
      Stream.filter((value) => value !== statuses),
      Stream.runForEach(() => registry.refreshTrust),
      Effect.forkScoped,
    );
    const entries = yield* registry.entries;
    yield* registry.changes.pipe(
      Stream.filter((value) => value !== entries),
      Stream.debounce(Duration.millis(50)),
      Stream.runForEach(() => events.publishEphemeral({ _tag: "ModulesChanged" })),
      Effect.forkScoped,
    );
  }),
);

export const handlerLayer = (options: {
  /** Adjusts catalog entries for this host, e.g. prefixing URLs with the base path. */
  readonly mapEntry: (entry: ModuleCatalog.Entry) => ModuleCatalog.Entry;
  readonly officialNamespace: string;
  readonly officialKeysConfigured: boolean;
}) =>
  Rpcs.toLayer(
    Effect.gen(function* () {
      const registry = yield* ModuleRegistry.Service;
      const installer = yield* Installer.Service;
      const toEntry = (entry: ModuleRegistry.Entry) =>
        options.mapEntry(ModuleRegistry.toCatalogEntry(entry));
      const catalog = Effect.map(registry.catalog, (entries) => entries.map(options.mapEntry));
      const installs = AdminHandlers.make(installer, {
        installed: (id) => registry.reload(id).pipe(Effect.map(toEntry), Effect.orDie),
        uninstalled: (id) =>
          registry.reload(id).pipe(Effect.catchTag("ModuleNotFound", () => Effect.void)),
        catalog,
        isShipped: (id) =>
          Effect.map(registry.get(id), (entry) =>
            Option.exists(entry, (value) => value.copies.some((copy) => copy.source === "shipped")),
          ),
      });
      const caller = Effect.map(EditorAccess.Connection, (identity) => ({
        actor: identity.email ?? identity.actor.userId ?? identity.actor.id,
      }));
      const requireOfficialKeys = (id: ModuleId.Id) =>
        ModuleId.namespace(id) === options.officialNamespace && !options.officialKeysConfigured
          ? Effect.fail(
              new ModuleAdminRpc.InstallFailed({
                id,
                message:
                  "This server has no signing keys for the official registry, so it can't verify releases from it. Set MACROGRAPH_REGISTRY_KEYS.",
              }),
            )
          : Effect.void;

      return Rpcs.of({
        GetModules: () => catalog,
        ListModules: () =>
          Effect.map(registry.details, (details) =>
            details.map((detail) => ({
              ...detail,
              entry: options.mapEntry(detail.entry),
            })),
          ),
        ReloadModule: ({ id }) => Effect.map(registry.reload(id), toEntry),
        RescanModules: () => registry.rescan.pipe(Effect.andThen(catalog)),
        SetModuleEnabled: ({ id, enabled }) =>
          registry.setEnabled(id, enabled).pipe(
            Effect.map(toEntry),
            Effect.catchTag("ModuleStateError", (error) => Effect.die(error)),
          ),
        ListRegistries: installs.ListRegistries,
        AddRegistry: installs.AddRegistry,
        RemoveRegistry: installs.RemoveRegistry,
        SetRegistryTrusted: installs.SetRegistryTrusted,
        SearchRegistry: installs.SearchRegistry,
        GetRegistryPackage: installs.GetRegistryPackage,
        InstallModule: (payload) =>
          requireOfficialKeys(payload.id).pipe(
            Effect.andThen(caller),
            Effect.flatMap((by) => installs.InstallModule(payload, by)),
          ),
        UpdateModule: (payload) =>
          requireOfficialKeys(payload.id).pipe(
            Effect.andThen(caller),
            Effect.flatMap((by) => installs.UpdateModule(payload, by)),
          ),
        UninstallModule: installs.UninstallModule,
        CheckForUpdates: installs.CheckForUpdates,
        LinkModule: ({ id, path }) =>
          registry.link(id, path).pipe(
            Effect.map(toEntry),
            Effect.catchTag("ModuleStateError", (error) => Effect.die(error)),
          ),
        UnlinkModule: ({ id }) =>
          registry.unlink(id).pipe(
            Effect.asVoid,
            Effect.catchTag("ModuleStateError", (error) => Effect.die(error)),
          ),
      });
    }),
  );

export * as ModuleAdmin from "./ModuleAdmin.ts";
