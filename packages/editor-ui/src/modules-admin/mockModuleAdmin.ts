import { ModuleAdminRpc, ModuleCatalog, ModuleId } from "@macrograph/module";
import { Effect, Exit, Scope } from "effect";
import { type Rpc, RpcTest } from "effect/rpc";

import type { ModuleAdminClient, SubscribeModulesChanged } from "./client.ts";

type Handlers = {
  readonly [Current in ModuleAdminRpc.ModuleAdminRpcs as Current["_tag"]]: Rpc.ToHandlerFn<
    Current,
    never
  >;
};

export interface MockModuleAdminState {
  modules: Array<ModuleAdminRpc.ModuleDetails>;
  registries: Array<ModuleAdminRpc.Registry>;
  packages: Array<ModuleAdminRpc.RegistryPackage>;
}

export interface MockModuleAdminOptions {
  readonly modules?: ReadonlyArray<ModuleAdminRpc.ModuleDetails>;
  readonly registries?: ReadonlyArray<ModuleAdminRpc.Registry>;
  readonly packages?: ReadonlyArray<ModuleAdminRpc.RegistryPackage>;
  /** Milliseconds every call waits before answering. */
  readonly latency?: number;
  /** Replace individual handlers, for example to make one fail. */
  readonly overrides?: Partial<Handlers>;
}

export interface MockModuleAdmin {
  readonly client: ModuleAdminClient;
  readonly state: MockModuleAdminState;
  readonly calls: Array<{ readonly tag: string; readonly payload: unknown }>;
  readonly subscribeModulesChanged: SubscribeModulesChanged;
  readonly emitModulesChanged: () => void;
  readonly dispose: () => void;
}

const toDetails = (
  pkg: ModuleAdminRpc.RegistryPackage,
  release: ModuleAdminRpc.RegistryRelease,
): ModuleAdminRpc.ModuleDetails => ({
  entry: {
    id: pkg.id,
    version: release.version,
    displayName: pkg.displayName,
    ...(pkg.description === undefined ? {} : { description: pkg.description }),
    source: "installed",
    status: "loaded",
    flags: ModuleCatalog.noFlags,
    trust: {
      registry: ModuleId.namespace(pkg.id),
      installed: release.trust,
      current: release.trust,
    },
  },
  enabled: true,
  copies: [
    {
      source: "installed",
      version: release.version,
      api: release.api,
      compatible: true,
      path: `installed/${pkg.id}/${release.version}`,
    },
  ],
});

/** An in-memory `ModuleAdminRpcs` server for stories and tests. */
export const createMockModuleAdmin = (options: MockModuleAdminOptions = {}): MockModuleAdmin => {
  const state: MockModuleAdminState = {
    modules: [...(options.modules ?? [])],
    registries: [...(options.registries ?? [])],
    packages: [...(options.packages ?? [])],
  };
  const calls: Array<{ readonly tag: string; readonly payload: unknown }> = [];
  const listeners = new Set<(event: ModuleAdminRpc.ModulesChanged) => void>();
  const emitModulesChanged = () => {
    for (const listener of listeners) listener({ _tag: "ModulesChanged" });
  };

  const catalog = () => state.modules.map((module) => module.entry);
  const findModule = (id: ModuleId.Id) =>
    Effect.suspend(() => {
      const module = state.modules.find((candidate) => candidate.entry.id === id);
      return module
        ? Effect.succeed(module)
        : Effect.fail(new ModuleAdminRpc.ModuleNotFound({ id }));
    });
  const replaceModule = (next: ModuleAdminRpc.ModuleDetails) => {
    const index = state.modules.findIndex((module) => module.entry.id === next.entry.id);
    if (index === -1) state.modules.push(next);
    else state.modules[index] = next;
    emitModulesChanged();
    return next.entry;
  };
  const findRegistry = (namespace: string) =>
    Effect.suspend(() => {
      const registry = state.registries.find((candidate) => candidate.namespace === namespace);
      return registry
        ? Effect.succeed(registry)
        : Effect.fail(new ModuleAdminRpc.RegistryNotFound({ namespace }));
    });
  const findPackage = (id: ModuleId.Id) =>
    Effect.suspend(() => {
      const pkg = state.packages.find((candidate) => candidate.id === id);
      return pkg ? Effect.succeed(pkg) : Effect.fail(new ModuleAdminRpc.ModuleNotFound({ id }));
    });
  const withInstalledVersion = (pkg: ModuleAdminRpc.RegistryPackage) => {
    const installed = state.modules.find((module) => module.entry.id === pkg.id);
    const { installedVersion: _, ...rest } = pkg;
    return installed ? { ...rest, installedVersion: installed.entry.version } : rest;
  };

  const install = (payload: {
    readonly id: ModuleId.Id;
    readonly version?: string;
    readonly acknowledgeUntrusted: boolean;
  }) =>
    Effect.gen(function* () {
      yield* findRegistry(ModuleId.namespace(payload.id));
      const pkg = yield* findPackage(payload.id);
      const release =
        payload.version === undefined
          ? pkg.releases.find((candidate) => candidate.status === "active" && candidate.compatible)
          : pkg.releases.find((candidate) => candidate.version === payload.version);
      if (!release)
        return yield* new ModuleAdminRpc.ReleaseNotFound({
          id: payload.id,
          ...(payload.version === undefined ? {} : { version: payload.version }),
        });
      if (!release.compatible)
        return yield* new ModuleAdminRpc.IncompatibleModule({
          id: payload.id,
          version: release.version,
          api: release.api,
          supported: [1],
        });
      if (release.status !== "active")
        return yield* new ModuleAdminRpc.ReleaseUnavailable({
          id: payload.id,
          version: release.version,
          status: release.status,
          ...(release.reason === undefined ? {} : { reason: release.reason }),
        });
      if (release.trust === "untrusted" && !payload.acknowledgeUntrusted)
        return yield* new ModuleAdminRpc.UntrustedConfirmationRequired({
          id: payload.id,
          version: release.version,
          registry: ModuleId.namespace(payload.id),
          requires: release.requires,
          node: release.node,
        });
      return replaceModule(toDetails(pkg, release));
    });

  const handlers: Handlers = {
    GetModules: () => Effect.sync(catalog),
    ListModules: () => Effect.sync(() => [...state.modules]),
    ReloadModule: ({ id }) =>
      Effect.map(findModule(id), (module) =>
        replaceModule({
          ...module,
          entry: {
            ...module.entry,
            status: module.enabled ? "loaded" : "disabled",
            flags: { ...module.entry.flags, stale: false },
          },
        }),
      ),
    RescanModules: () => Effect.sync(catalog),
    SetModuleEnabled: ({ id, enabled }) =>
      Effect.map(findModule(id), (module) =>
        replaceModule({
          ...module,
          enabled,
          entry: { ...module.entry, status: enabled ? "loaded" : "disabled" },
        }),
      ),
    ListRegistries: () => Effect.sync(() => [...state.registries]),
    AddRegistry: ({ url }) =>
      Effect.suspend(
        (): Effect.Effect<
          ModuleAdminRpc.Registry,
          ModuleAdminRpc.RegistryConflict | ModuleAdminRpc.RegistryError
        > => {
          let namespace: string;
          try {
            namespace = new URL(url).hostname;
          } catch {
            return Effect.fail(new ModuleAdminRpc.RegistryError({ url, message: "Invalid URL" }));
          }
          const existing = state.registries.find((registry) => registry.namespace === namespace);
          if (existing)
            return Effect.fail(
              new ModuleAdminRpc.RegistryConflict({ namespace, url: existing.url }),
            );
          const registry: ModuleAdminRpc.Registry = {
            namespace,
            url,
            displayName: namespace,
            official: false,
            trusted: false,
            keys: ["mock-key"],
          };
          state.registries.push(registry);
          return Effect.succeed(registry);
        },
      ),
    RemoveRegistry: ({ namespace }) =>
      Effect.map(findRegistry(namespace), (registry) => {
        state.registries = state.registries.filter((candidate) => candidate !== registry);
      }),
    SetRegistryTrusted: ({ namespace, trusted }) =>
      Effect.map(findRegistry(namespace), (registry) => {
        const next = { ...registry, trusted };
        state.registries = state.registries.map((candidate) =>
          candidate === registry ? next : candidate,
        );
        return next;
      }),
    SearchRegistry: ({ namespace, query }) =>
      Effect.gen(function* () {
        if (namespace !== undefined) yield* findRegistry(namespace);
        const needle = query.trim().toLowerCase();
        return state.packages
          .filter(
            (pkg) =>
              (namespace === undefined || ModuleId.namespace(pkg.id) === namespace) &&
              (needle === "" ||
                pkg.id.includes(needle) ||
                pkg.displayName.toLowerCase().includes(needle) ||
                (pkg.description ?? "").toLowerCase().includes(needle)),
          )
          .flatMap((pkg) => {
            const latest = pkg.releases.find((release) => release.status === "active");
            if (!latest) return [];
            const withInstalled = withInstalledVersion(pkg);
            return [
              {
                id: pkg.id,
                displayName: pkg.displayName,
                ...(pkg.description === undefined ? {} : { description: pkg.description }),
                latestVersion: latest.version,
                ...("installedVersion" in withInstalled
                  ? { installedVersion: withInstalled.installedVersion }
                  : {}),
              },
            ];
          });
      }),
    GetRegistryPackage: ({ id }) => Effect.map(findPackage(id), withInstalledVersion),
    InstallModule: install,
    UpdateModule: (payload) => Effect.flatMap(findModule(payload.id), () => install(payload)),
    UninstallModule: ({ id }) =>
      Effect.flatMap(findModule(id), (module) => {
        if (module.entry.source !== "installed")
          return Effect.fail(
            new ModuleAdminRpc.NotUninstallable({
              id,
              reason: `${module.entry.source} modules can't be uninstalled`,
            }),
          );
        state.modules = state.modules.filter((candidate) => candidate !== module);
        emitModulesChanged();
        return Effect.void;
      }),
    CheckForUpdates: () => Effect.sync(catalog),
    LinkModule: ({ id, path }) =>
      Effect.suspend(() => {
        if (!path.startsWith("/"))
          return Effect.fail(
            new ModuleAdminRpc.InvalidLink({ path, message: "The path must be absolute" }),
          );
        const existing = state.modules.find((module) => module.entry.id === id);
        return Effect.succeed(
          replaceModule({
            entry: {
              id,
              version: existing?.entry.version ?? "0.0.0",
              displayName: existing?.entry.displayName ?? ModuleId.name(id),
              source: "linked",
              status: "loaded",
              flags: ModuleCatalog.noFlags,
            },
            enabled: true,
            path,
            copies: [
              ...(existing?.copies ?? []),
              {
                source: "linked",
                version: existing?.entry.version ?? "0.0.0",
                api: 1,
                compatible: true,
                path,
              },
            ],
          }),
        );
      }),
    UnlinkModule: ({ id }) =>
      Effect.map(findModule(id), (module) => {
        state.modules = state.modules.filter((candidate) => candidate !== module);
        emitModulesChanged();
      }),
    ...options.overrides,
  };

  const scope = Scope.makeUnsafe();
  const inner = Effect.runSync(
    RpcTest.makeClient(ModuleAdminRpc.ModuleAdminRpcs).pipe(
      Effect.provide(ModuleAdminRpc.ModuleAdminRpcs.toLayer(handlers)),
      Scope.provide(scope),
    ),
  );

  // Record every call and delay it by the configured latency.
  const latency = options.latency ?? 0;
  const client: ModuleAdminClient = new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== "string" || typeof value !== "function") return value;
      return (payload: unknown, callOptions: unknown) => {
        calls.push({ tag: property, payload });
        return Effect.andThen(Effect.sleep(latency), value(payload, callOptions));
      };
    },
  });

  return {
    client,
    state,
    calls,
    emitModulesChanged,
    subscribeModulesChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => Effect.runFork(Scope.close(scope, Exit.void)),
  };
};
