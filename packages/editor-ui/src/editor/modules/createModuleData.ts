import type { EditorEvent } from "@macrograph/editor";
import type { ClientSettings } from "@macrograph/module/ClientSettings";
import type { JSX } from "@solidjs/web";

import { Actor, type Package, type ResourceConstant } from "@macrograph/core";
import { Cause, Effect, Exit, Scope } from "effect";
import { createMemo, getOwner, refresh, runWithOwner } from "solid-js";

import type { ModuleCatalogStore } from "./createModuleCatalog";
import type { ModuleCatalogEntry } from "./ModuleCatalogSource";
import type { ModuleRpcProtocolFactory } from "./ModuleRpcProtocol";
import type { ModuleSettingsData } from "./ModuleSettingsView";
import type { ModuleUIHandle, ModuleUILoader } from "./ModuleUILoader";

import { runFork, runPromise } from "../../observability/browserTracing";

type Connection = {
  readonly client: {
    readonly GetIngressEndpoints: (
      payload: Record<string, never>,
    ) => Effect.Effect<ModuleSettingsData["endpoints"], unknown>;
    readonly GetModuleSettingsCapabilities: () => Effect.Effect<
      ReadonlyArray<{ readonly moduleId: string }>,
      unknown
    >;
    readonly GetModuleClientState: (payload: {
      readonly moduleId: string;
    }) => Effect.Effect<unknown, unknown>;
    readonly ReloadResource: (payload: {
      readonly package: string;
      readonly resource: string;
    }) => Effect.Effect<unknown, unknown>;
    readonly GetResourceValues: (payload: {
      readonly package: string;
      readonly resource: string;
    }) => Effect.Effect<ReadonlyArray<ResourceConstant.LiveValue>, unknown>;
  };
};

type Packages = ReadonlyArray<Pick<Package.Model, "id" | "resources">>;

/** The outcome of loading a module's settings UI and connecting it to the module's RPCs. */
export type ModuleSettingsResult =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "None" }
  | { readonly _tag: "Ready"; readonly connected: ClientSettings.Connected<JSX.Element> }
  | { readonly _tag: "Failed"; readonly message: string };

/** A module's settings as the settings view consumes them. */
export interface ModuleSettingsSource {
  /** Loads the module's UI and keeps it connected and styled until the returned function runs. */
  readonly open: () => () => void;
  readonly settings: () => ModuleSettingsResult;
  readonly state: () => unknown;
}

const errorMessage = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause);
  if (error instanceof Error) {
    const inner = error.cause instanceof Error ? `: ${error.cause.message}` : "";
    return `${error.message}${inner}`;
  }
  return String(error);
};

export function createModuleData(
  modules: { readonly catalog: ModuleCatalogStore; readonly loader: ModuleUILoader },
  applyEvent: (event: EditorEvent.EditorEvent) => void,
) {
  const owner = getOwner();
  let session:
    | {
        readonly connection: Connection;
        readonly rpcProtocol: ModuleRpcProtocolFactory;
        packages: Packages;
        readonly resourceRequests: Map<string, object>;
      }
    | undefined;
  const query = <A>(initial: A, label: string) => {
    let value = initial;
    let pending: Promise<A> = Promise.resolve(initial);
    // Start requests independently of Solid; the memo only exposes their results.
    const state = createMemo(() => pending);
    return {
      state,
      load(effect: Effect.Effect<A, unknown>) {
        const request = runPromise(
          effect.pipe(
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                if (!Cause.hasInterruptsOnly(cause)) yield* Effect.logError(label, cause);
                return value;
              }),
            ),
          ),
        ).then((result) => {
          if (pending === request) value = result;
          return result;
        });
        pending = request;
        refresh(state);
        return request;
      },
      clear(retain: boolean) {
        if (!retain) value = initial;
        pending = Promise.resolve(value);
        refresh(state);
      },
    };
  };
  const emptyMetadata: ModuleSettingsData = { endpoints: [], capabilities: new Set() };
  const metadata = query(emptyMetadata, "Failed to load module settings");

  interface ModuleRecord {
    readonly id: string;
    readonly settings: ReturnType<typeof query<ModuleSettingsResult>>;
    readonly state: ReturnType<typeof query<unknown>>;
    holds: number;
    key: string | undefined;
    handle: ModuleUIHandle | undefined;
    scope: Scope.Closeable | undefined;
    connected: ClientSettings.Connected<JSX.Element> | undefined;
    attempt: object;
  }
  const records = new Map<string, ModuleRecord>();
  const record = (id: string) => {
    let existing = records.get(id);
    if (existing === undefined) {
      // Records are created on demand, so tie their memos to the owner of the module data.
      existing = runWithOwner(owner, () => ({
        id,
        settings: query<ModuleSettingsResult>({ _tag: "Idle" }, `Failed to load ${id} settings`),
        state: query<unknown>(undefined, `Failed to load ${id} module state`),
        holds: 0,
        key: undefined,
        handle: undefined,
        scope: undefined,
        connected: undefined,
        attempt: {},
      }));
      records.set(id, existing);
    }
    return existing;
  };

  const disconnectRecord = (target: ModuleRecord) => {
    target.attempt = {};
    target.connected = undefined;
    const scope = target.scope;
    target.scope = undefined;
    if (scope !== undefined) runFork(Scope.close(scope, Exit.void));
  };

  const releaseRecord = (target: ModuleRecord) => {
    disconnectRecord(target);
    target.handle?.release();
    target.handle = undefined;
    target.key = undefined;
  };

  const loadState = (target: ModuleRecord) => {
    const current = session;
    const connected = target.connected;
    if (current === undefined || connected === undefined) return Promise.resolve();
    return target.state.load(
      connected.load(current.connection.client.GetModuleClientState({ moduleId: target.id })),
    );
  };

  /** Loads the module's UI for the current catalog entry and connects it to the session. */
  const connectRecord = (target: ModuleRecord) => {
    const entry = modules.catalog.current().get(target.id);
    const key = entry === undefined ? undefined : modules.loader.key(entry);
    if (target.key !== key || target.handle === undefined) {
      releaseRecord(target);
      target.key = key;
      target.handle = entry === undefined ? undefined : modules.loader.acquire(entry);
    } else disconnectRecord(target);
    const current = session;
    const handle = target.handle;
    if (current === undefined) return Promise.resolve();
    if (handle === undefined) {
      target.settings.load(Effect.succeed({ _tag: "None" }));
      target.state.clear(false);
      return Promise.resolve();
    }
    const attempt = {};
    target.attempt = attempt;
    const scope = Scope.makeUnsafe();
    target.scope = scope;
    return target.settings.load(
      Effect.gen(function* () {
        const descriptor = yield* Effect.tryPromise({
          try: () => handle.descriptor,
          catch: (error) => error,
        });
        const settings = descriptor.settings;
        if (settings === undefined) return { _tag: "None" } as const;
        const rpc = yield* current.rpcProtocol(target.id);
        const connected = yield* rpc._tag === "Protocol"
          ? settings.connect(rpc.protocol)
          : settings.connectInProcess.pipe(Effect.provide(rpc.context));
        return { _tag: "Ready", connected } as const;
      }).pipe(
        Scope.provide(scope),
        Effect.tap((result) =>
          Effect.sync(() => {
            if (target.attempt !== attempt || session !== current) return;
            target.connected = result._tag === "Ready" ? result.connected : undefined;
            void loadState(target);
          }),
        ),
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.logError(`Failed to load ${target.id} settings`, cause).pipe(
                Effect.as({ _tag: "Failed", message: errorMessage(cause) } as const),
              ),
        ),
      ),
    );
  };

  modules.catalog.onChange((next, previous) => {
    for (const target of records.values()) {
      if (target.holds === 0) continue;
      const before = previous.get(target.id);
      const after = next.get(target.id);
      if (before === after) continue;
      const key = after === undefined ? undefined : modules.loader.key(after);
      // Reconnect when the module appears, disappears or its UI code changes.
      if (key !== target.key || (before === undefined) !== (after === undefined))
        void connectRecord(target);
    }
  });

  const reloadResources = (moduleId?: string) => {
    const current = session;
    if (current === undefined) return Promise.resolve();
    return runPromise(
      Effect.forEach(
        current.packages.filter((pkg) => moduleId === undefined || pkg.id === moduleId),
        (pkg) => {
          const request = {};
          current.resourceRequests.set(pkg.id, request);
          return Effect.forEach(
            pkg.resources,
            (resource) =>
              current.connection.client
                .ReloadResource({ package: pkg.id, resource: resource.id })
                .pipe(
                  Effect.andThen(
                    current.connection.client.GetResourceValues({
                      package: pkg.id,
                      resource: resource.id,
                    }),
                  ),
                  Effect.tap((values) =>
                    Effect.sync(() => {
                      if (session !== current || current.resourceRequests.get(pkg.id) !== request)
                        return;
                      applyEvent({
                        _tag: "ResourceValuesUpdated",
                        actor: Actor.system,
                        package: pkg.id,
                        resource: resource.id,
                        values,
                      });
                    }),
                  ),
                  Effect.catchCause((cause) =>
                    Effect.logError(
                      `Failed to load ${pkg.id}/${resource.id} resource values`,
                      cause,
                    ),
                  ),
                ),
            { concurrency: "unbounded", discard: true },
          );
        },
        { concurrency: "unbounded", discard: true },
      ),
    );
  };

  const reload = (moduleId?: string) => {
    const current = session;
    if (current === undefined) return Promise.resolve();
    const client = current.connection.client;
    const pending: Array<Promise<unknown>> = [
      metadata.load(
        Effect.all([client.GetIngressEndpoints({}), client.GetModuleSettingsCapabilities()], {
          concurrency: "unbounded",
        }).pipe(
          Effect.map(([endpoints, capabilities]) => ({
            endpoints,
            capabilities: new Set(capabilities.map((capability) => capability.moduleId)),
          })),
        ),
      ),
    ];
    for (const target of records.values())
      if (moduleId === undefined || target.id === moduleId) pending.push(loadState(target));
    pending.push(reloadResources(moduleId));
    return Promise.all(pending).then(() => undefined);
  };

  const sources = new Map<string, ModuleSettingsSource>();

  return {
    metadata: metadata.state,
    /** Settings for the module, or `undefined` when the catalog has no UI for it. */
    settings(id: string): ModuleSettingsSource | undefined {
      const entry: ModuleCatalogEntry | undefined = modules.catalog.get(id);
      if (entry === undefined || modules.loader.key(entry) === undefined) return undefined;
      let source = sources.get(id);
      if (source === undefined) {
        const target = record(id);
        source = {
          open() {
            target.holds++;
            // `open` runs inside a settings view effect. Refreshing the settings memo synchronously
            // there can leave Solid re-running that effect forever while switching module tabs.
            if (target.holds === 1)
              queueMicrotask(() => {
                if (target.holds > 0) void connectRecord(target);
              });
            let closed = false;
            return () => {
              if (closed) return;
              closed = true;
              target.holds--;
              if (target.holds > 0) return;
              queueMicrotask(() => {
                if (target.holds > 0) return;
                releaseRecord(target);
                target.settings.clear(false);
              });
            };
          },
          settings: target.settings.state,
          state: target.state.state,
        };
        sources.set(id, source);
      }
      return source;
    },
    /** Module ids with open settings, for diagnostics and tests. */
    open: () => [...records.values()].filter((target) => target.holds > 0).map(({ id }) => id),
    refresh: reload,
    connect(connection: Connection, packages: Packages, rpcProtocol: ModuleRpcProtocolFactory) {
      session = { connection, packages, rpcProtocol, resourceRequests: new Map() };
      const pending = [reload()];
      for (const target of records.values())
        if (target.holds > 0) pending.push(connectRecord(target).then(() => undefined));
      return Promise.all(pending).then(() => undefined);
    },
    /** Replaces the package list after the host's modules changed, reloading resource values. */
    setPackages(packages: Packages) {
      if (session === undefined) return Promise.resolve();
      session.packages = packages;
      return reloadResources();
    },
    disconnect(keepData = false) {
      session = undefined;
      metadata.clear(keepData);
      for (const target of records.values()) {
        disconnectRecord(target);
        target.settings.clear(keepData);
        target.state.clear(keepData);
      }
    },
  };
}
