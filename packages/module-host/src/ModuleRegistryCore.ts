import { HostService } from "@macrograph/module/HostService";
import { Manifest } from "@macrograph/module/Manifest";
import { ModuleAdminRpc } from "@macrograph/module/ModuleAdminRpc";
import { ModuleCatalog } from "@macrograph/module/ModuleCatalog";
import { ModuleId } from "@macrograph/module/ModuleId";
import {
  Cause,
  Context,
  Effect,
  Exit,
  FiberHandle,
  Layer,
  Option,
  Result,
  Scope,
  Semaphore,
  Stream,
  SubscriptionRef,
} from "effect";

import { ModuleCopies } from "./ModuleCopies.ts";
import { ModuleState } from "./ModuleState.ts";
import { ModuleTrust } from "./ModuleTrust.ts";
import { ModuleUrls } from "./ModuleUrls.ts";
import { Mounter } from "./Mounter.ts";
import { VersionSelection } from "./VersionSelection.ts";

/** What exists only while a module is loaded. */
export interface Loaded {
  /** Closed on unload; everything the module registered belongs to it. */
  readonly scope: Scope.Closeable;
  /** The server entry's default export. */
  readonly deployment: unknown;
  readonly rpc: Option.Option<Mounter.RpcHandler>;
  /** Folder its `ui/` and `assets/` are served from. */
  readonly root: Option.Option<string>;
  readonly contentHash: string;
}

export interface Entry {
  readonly id: ModuleId.Id;
  readonly manifest: Option.Option<Manifest.Model>;
  readonly source: Option.Option<ModuleCatalog.SourceKind>;
  /** The folder of the copy that is loaded, or that would be loaded. */
  readonly root: Option.Option<string>;
  readonly status: ModuleCatalog.Status;
  readonly enabled: boolean;
  readonly flags: ModuleCatalog.Flags;
  /** Why loading failed, readable by a person. */
  readonly error: Option.Option<string>;
  readonly trust: Option.Option<ModuleCatalog.Trust>;
  /** Hash of the loaded (or last attempted) copy's files. */
  readonly contentHash: Option.Option<string>;
  readonly copies: ReadonlyArray<ModuleAdminRpc.ModuleCopy>;
  readonly loaded: Option.Option<Loaded>;
}

export type Entries = ReadonlyMap<ModuleId.Id, Entry>;

export interface Options {
  /** `api` versions this host loads. Defaults to `[Manifest.ApiVersion]`. */
  readonly supportedApis?: ReadonlyArray<number>;
  /** Host services this host provides (section 10). */
  readonly hostServices: ReadonlyArray<HostService.Id>;
}

/**
 * What the registry needs from the host platform: where copies come from and how folders are
 * read. The Node host (`@macrograph/module-host/ModuleRegistry`) reads folders, evaluates server
 * entries with `vm` and watches for changes; static hosts (`StaticRegistry`) only have imported
 * modules.
 */
export interface Platform {
  /** Enabled flags and dev links. */
  readonly state: ModuleState.Store;
  /** Rereads every source and groups the copies found by module id. Never fails. */
  readonly scan: (state: ModuleState.Model) => Effect.Effect<ModuleCopies.Groups>;
  /** The content hash of a copy: its folder's hash, or the static module's declared hash. */
  readonly contentHash: (
    copy: ModuleCopies.Copy,
  ) => Effect.Effect<string, { readonly message: string }>;
  /** Turns a module folder into its server entry's default export. */
  readonly evaluate: (
    copy: ModuleCopies.Copy,
    root: string,
  ) => Effect.Effect<unknown, { readonly message: string }>;
  /** Rehashes a folder to detect staleness. `None` when it can't be read. */
  readonly hashFolder: (root: string) => Effect.Effect<Option.Option<string>>;
  /** Whether `child` is `parent` or inside it. */
  readonly isWithin: (parent: string, child: string) => boolean;
  /** The file for a path inside a loaded module's `ui/` or `assets/` folder. */
  readonly resolveFile: (
    root: string,
    kind: ModuleUrls.StaticKind,
    path: string,
  ) => Option.Option<string>;
  /** Validates a folder to link under an id; omitted when the host can't link folders. */
  readonly link?: (
    id: ModuleId.Id,
    path: string,
  ) => Result.Result<{ readonly copy: ModuleCopies.Copy; readonly root: string }, string>;
  /** Watches local and linked folders; omitted when the host doesn't watch. */
  readonly watch?: {
    /** Emits the folders that changed. Restarted whenever links change or after a rescan. */
    readonly changes: (state: ModuleState.Model) => Stream.Stream<ReadonlySet<string>>;
    /** Modules tied to a changed folder that are flagged stale without hashing. */
    readonly staleWithoutHash: (changed: ReadonlySet<string>) => ReadonlyArray<ModuleId.Id>;
    /**
     * Reload local and linked modules as soon as their content changes, instead of flagging them
     * stale for an admin to reload. Meant for development.
     */
    readonly autoReload?: boolean;
  };
}

export interface StaticFile {
  /** Absolute path of the file to serve. */
  readonly path: string;
  /** The URL's version matches the loaded content, so the response can be cached forever. */
  readonly immutable: boolean;
}

/** Server-wide registry of modules: discovery, version selection, loading and unloading. */
export class Service extends Context.Service<
  Service,
  {
    readonly entries: Effect.Effect<Entries>;
    readonly get: (id: ModuleId.Id) => Effect.Effect<Option.Option<Entry>>;
    /** The current entries, then every change. Broadcast `ModulesChanged` from this. */
    readonly changes: Stream.Stream<Entries>;
    /** Loads a module if it isn't loaded yet. Failures are recorded on the entry. */
    readonly load: (id: ModuleId.Id) => Effect.Effect<Entry, ModuleAdminRpc.ModuleNotFound>;
    readonly unload: (id: ModuleId.Id) => Effect.Effect<Entry, ModuleAdminRpc.ModuleNotFound>;
    /**
     * Unloads, rereads the module's copies and loads again. No rollback: a failure leaves the
     * entry `failed`. Fails with `ModuleNotFound` (after unloading) if no copy is left.
     */
    readonly reload: (id: ModuleId.Id) => Effect.Effect<Entry, ModuleAdminRpc.ModuleNotFound>;
    /** Rereads every source: loads new modules, unloads removed ones, flags changed ones stale. */
    readonly rescan: Effect.Effect<Entries>;
    readonly setEnabled: (
      id: ModuleId.Id,
      enabled: boolean,
    ) => Effect.Effect<Entry, ModuleAdminRpc.ModuleNotFound | ModuleState.ModuleStateError>;
    readonly link: (
      id: ModuleId.Id,
      path: string,
    ) => Effect.Effect<Entry, ModuleAdminRpc.InvalidLink | ModuleState.ModuleStateError>;
    /** Removes a dev link and reloads whatever copy is left, if any. */
    readonly unlink: (
      id: ModuleId.Id,
    ) => Effect.Effect<
      Option.Option<Entry>,
      ModuleAdminRpc.ModuleNotFound | ModuleState.ModuleStateError
    >;
    /** Rehashes loaded folders and flags the ones that changed. The watcher calls this. */
    readonly checkStale: Effect.Effect<void>;
    /** Asks `ModuleTrust` again for every entry, e.g. after the installer checked registries. */
    readonly refreshTrust: Effect.Effect<void>;
    readonly catalog: Effect.Effect<ModuleCatalog.Catalog>;
    readonly details: Effect.Effect<ReadonlyArray<ModuleAdminRpc.ModuleDetails>>;
    readonly rpcHandler: (
      id: ModuleId.Id,
    ) => Effect.Effect<
      Option.Option<Mounter.RpcHandler>,
      ModuleAdminRpc.ModuleNotFound | ModuleAdminRpc.ModuleNotLoaded
    >;
    /** Resolves `<kind>/<version>/<path>` under a loaded module's folder. */
    readonly staticFile: (
      id: ModuleId.Id,
      kind: ModuleUrls.StaticKind,
      rest: string,
    ) => Effect.Effect<
      Option.Option<StaticFile>,
      ModuleAdminRpc.ModuleNotFound | ModuleAdminRpc.ModuleNotLoaded
    >;
  }
>()("@macrograph/module-host/ModuleRegistry") {}

const defaultSource = (id: ModuleId.Id): ModuleCatalog.SourceKind =>
  ModuleId.isLocal(id) ? "local" : "shipped";

/** The editor-facing catalog entry. UI and icon URLs are only set while the module is loaded. */
export const toCatalogEntry = (entry: Entry): ModuleCatalog.Entry => {
  const manifest = Option.getOrUndefined(entry.manifest);
  const loaded = Option.getOrUndefined(entry.loaded);
  const urlFor = (kind: ModuleUrls.StaticKind, path: string) =>
    loaded !== undefined && Option.isSome(loaded.root)
      ? Option.getOrUndefined(ModuleUrls.url(entry.id, loaded.contentHash, kind, path))
      : undefined;
  const iconUrl = manifest?.icon === undefined ? undefined : urlFor("assets", manifest.icon);
  const entryUrl = manifest?.ui === undefined ? undefined : urlFor("ui", manifest.ui.entry);
  const styleUrls = (manifest?.ui?.styles ?? []).flatMap((path) => urlFor("ui", path) ?? []);
  const error = Option.getOrUndefined(entry.error);
  const trust = Option.getOrUndefined(entry.trust);
  return {
    id: entry.id,
    version: manifest?.version ?? "0.0.0",
    displayName: manifest?.displayName ?? ModuleId.toDisplay(entry.id),
    ...(manifest?.description === undefined ? {} : { description: manifest.description }),
    source: Option.getOrElse(entry.source, () => defaultSource(entry.id)),
    status: entry.status,
    flags: entry.flags,
    ...(error === undefined ? {} : { error }),
    ...(trust === undefined ? {} : { trust }),
    ...(iconUrl === undefined ? {} : { iconUrl }),
    ...(entryUrl === undefined ? {} : { ui: { entryUrl, styleUrls } }),
  };
};

export const toDetails = (entry: Entry): ModuleAdminRpc.ModuleDetails => {
  const root = Option.getOrUndefined(entry.root);
  const contentHash = Option.getOrUndefined(entry.contentHash);
  const manifest = Option.getOrUndefined(entry.manifest);
  return {
    entry: toCatalogEntry(entry),
    enabled: entry.enabled,
    ...(root === undefined ? {} : { path: root }),
    ...(contentHash === undefined ? {} : { contentHash }),
    ...(manifest === undefined ? {} : { manifest }),
    copies: entry.copies,
  };
};

const sortedEntries = (entries: Entries) =>
  [...entries.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );

const describeCause = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.squash(cause);
  if (typeof error === "string") return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  )
    return Cause.hasDies(cause) ? Cause.pretty(cause) : error.message;
  return Cause.pretty(cause);
};

const sameCopy = (entry: Entry, copy: ModuleCopies.Copy) =>
  Option.getOrUndefined(entry.root) === Option.getOrUndefined(copy.root) &&
  Option.contains(entry.source, copy.source) &&
  Option.exists(entry.manifest, (manifest) => manifest.version === copy.manifest.version);

/** Builds the registry on a platform. Startup scans every source and loads every enabled module. */
export const make = (options: Options, platform: Platform) =>
  Effect.gen(function* () {
    const mounter = yield* Mounter.Service;
    const trustProvider = yield* ModuleTrust.Service;
    const registryScope = yield* Effect.scope;
    const state = platform.state;
    const supportedApis: ReadonlySet<number> = new Set(
      options.supportedApis ?? [Manifest.ApiVersion],
    );
    const hostServices: ReadonlySet<HostService.Id> = new Set(options.hostServices);

    const ref = yield* SubscriptionRef.make<Entries>(new Map());
    const lock = yield* Semaphore.make(1);
    const locked = <A, E>(effect: Effect.Effect<A, E>) => Semaphore.withPermit(lock, effect);

    const current = SubscriptionRef.get(ref);
    const lookup = (id: ModuleId.Id) => Effect.map(current, (entries) => entries.get(id));
    const setEntry = (entry: Entry) =>
      SubscriptionRef.update(ref, (entries) => new Map(entries).set(entry.id, entry)).pipe(
        Effect.as(entry),
      );
    const removeEntry = (id: ModuleId.Id) =>
      SubscriptionRef.update(ref, (entries) => {
        const next = new Map(entries);
        next.delete(id);
        return next;
      });

    const scan = Effect.flatMap(state.get, platform.scan);

    const lookupTrust = (copy: ModuleCopies.Copy) =>
      trustProvider.lookup({
        id: copy.id,
        source: copy.source,
        version: copy.manifest.version,
        root: copy.root,
      });

    const withTrust = (entry: Entry, status: ModuleTrust.Status): Entry => ({
      ...entry,
      trust: status.trust,
      flags: { ...entry.flags, revoked: status.revoked, updateAvailable: status.updateAvailable },
    });

    /** An entry describing a selection without loading anything. */
    const describe = (
      id: ModuleId.Id,
      selection: VersionSelection.Selection,
      enabled: boolean,
    ): Effect.Effect<Entry> =>
      Effect.gen(function* () {
        const described = Option.getOrUndefined(selection.described);
        const entry: Entry = {
          id,
          manifest: selection.manifest,
          source: Option.fromNullishOr(described?.source),
          root: described === undefined ? Option.none() : described.root,
          status: enabled ? "discovered" : "disabled",
          enabled,
          flags: {
            ...ModuleCatalog.noFlags,
            incompatibleInstalled: selection.incompatibleInstalled,
          },
          error: Option.none(),
          trust: Option.none(),
          contentHash: Option.none(),
          copies: selection.copies,
          loaded: Option.none(),
        };
        return described === undefined ? entry : withTrust(entry, yield* lookupTrust(described));
      });

    const checkPackage = (copy: ModuleCopies.Copy): Option.Option<string> => {
      const missing = HostService.missing(copy.manifest.requires ?? [], hostServices);
      if (missing.length > 0)
        return Option.some(
          `Requires host services this host doesn't provide: ${missing.join(", ")}`,
        );
      if (Option.isNone(copy.root)) return Option.none();
      const misplaced = [
        ...(copy.manifest.ui === undefined
          ? []
          : [copy.manifest.ui.entry, ...copy.manifest.ui.styles].filter((path) =>
              Option.isNone(ModuleUrls.pathInKind("ui", path)),
            )),
        ...(copy.manifest.icon !== undefined &&
        Option.isNone(ModuleUrls.pathInKind("assets", copy.manifest.icon))
          ? [copy.manifest.icon]
          : []),
      ];
      return misplaced.length > 0
        ? Option.some(
            `UI files must be inside ui/ and the icon inside assets/: ${misplaced.join(", ")}`,
          )
        : Option.none();
    };

    /** Evaluates and mounts a copy in a new scope. */
    const mountCopy = (copy: ModuleCopies.Copy, contentHash: string) =>
      Effect.gen(function* () {
        const problem = checkPackage(copy);
        if (Option.isSome(problem)) return yield* Effect.fail(problem.value);
        const deployment = yield* Option.match(copy.static, {
          onSome: (value) => Effect.succeed(value.deployment),
          onNone: () =>
            Option.match(copy.root, {
              onNone: () => Effect.fail("The module has no folder to load from"),
              onSome: (root) =>
                platform.evaluate(copy, root).pipe(Effect.mapError((error) => error.message)),
            }),
        });
        return yield* Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const scope = yield* Scope.fork(registryScope, "sequential");
            const exit = yield* restore(
              mounter.mount({
                id: copy.id,
                manifest: copy.manifest,
                source: copy.source,
                root: copy.root,
                deployment,
              }),
            ).pipe(Scope.provide(scope), Effect.exit);
            if (Exit.isFailure(exit)) {
              yield* Scope.close(scope, exit);
              return yield* Effect.fail(`Mounting failed: ${describeCause(exit.cause)}`);
            }
            return {
              scope,
              deployment,
              rpc: exit.value.rpc,
              root: copy.root,
              contentHash,
            } satisfies Loaded;
          }),
        );
      });

    /** Describes a selection and, if enabled, loads its chosen copy. Never fails. */
    const attempt = (
      id: ModuleId.Id,
      selection: VersionSelection.Selection,
      enabled: boolean,
    ): Effect.Effect<Entry> =>
      Effect.gen(function* () {
        const base = yield* describe(id, selection, enabled);
        if (!enabled) return yield* setEntry(base);
        if (Option.isNone(selection.chosen))
          return yield* setEntry({
            ...base,
            status: "failed",
            error: Option.orElse(selection.error, () => Option.some("No usable copy")),
          });
        const copy = selection.chosen.value;
        const hash = yield* Effect.result(platform.contentHash(copy));
        if (Result.isFailure(hash))
          return yield* setEntry({
            ...base,
            status: "failed",
            error: Option.some(hash.failure.message),
          });
        const loading = yield* setEntry({
          ...base,
          status: "loading",
          contentHash: Option.some(hash.success),
        });
        const exit = yield* Effect.exit(mountCopy(copy, hash.success));
        if (Exit.isSuccess(exit))
          return yield* setEntry({
            ...loading,
            status: "loaded",
            loaded: Option.some(exit.value),
          });
        const error = describeCause(exit.cause);
        yield* Effect.logWarning(`Module ${id} failed to load: ${error}`);
        return yield* setEntry({ ...loading, status: "failed", error: Option.some(error) });
      });

    const unloadEntry = (entry: Entry): Effect.Effect<Entry> =>
      Effect.gen(function* () {
        if (Option.isSome(entry.loaded)) yield* Scope.close(entry.loaded.value.scope, Exit.void);
        return {
          ...entry,
          status: entry.enabled ? "discovered" : "disabled",
          error: Option.none(),
          loaded: Option.none(),
        } satisfies Entry;
      });

    /** Unloads a module if loaded, rereads its copies and loads it again if enabled. */
    const refresh = (id: ModuleId.Id): Effect.Effect<Option.Option<Entry>> =>
      Effect.gen(function* () {
        const existing = yield* lookup(id);
        if (existing !== undefined && Option.isSome(existing.loaded))
          yield* setEntry(yield* unloadEntry(existing));
        const group = (yield* scan).get(id);
        if (group === undefined) {
          yield* removeEntry(id);
          return Option.none();
        }
        const enabled = ModuleState.isEnabled(yield* state.get, id);
        return Option.some(
          yield* attempt(id, VersionSelection.select(group, supportedApis), enabled),
        );
      });

    const notFound = (id: string) => new ModuleAdminRpc.ModuleNotFound({ id });

    const requireEntry = (id: ModuleId.Id) =>
      Effect.flatMap(lookup(id), (entry) =>
        entry === undefined ? Effect.fail(notFound(id)) : Effect.succeed(entry),
      );

    const requireLoaded = (id: ModuleId.Id) =>
      Effect.flatMap(requireEntry(id), (entry) =>
        Option.match(entry.loaded, {
          onSome: (loaded) => Effect.succeed(loaded),
          onNone: () => {
            const error = Option.getOrUndefined(entry.error);
            return Effect.fail(
              new ModuleAdminRpc.ModuleNotLoaded({
                id,
                status: entry.status,
                ...(error === undefined ? {} : { error }),
              }),
            );
          },
        }),
      );

    const markStale = (id: ModuleId.Id) =>
      Effect.gen(function* () {
        const entry = yield* lookup(id);
        if (entry === undefined || entry.flags.stale) return;
        if (entry.status !== "loaded" && entry.status !== "failed") return;
        yield* setEntry({ ...entry, flags: { ...entry.flags, stale: true } });
      });

    /**
     * Rehashes loaded and failed folders under the given roots (all if omitted), flags changed
     * ones stale and returns them. `includeStale` rehashes already-stale folders too.
     */
    const checkStaleUnder = (changed: Option.Option<ReadonlySet<string>>, includeStale = false) =>
      Effect.gen(function* () {
        const changedIds: Array<{ readonly id: ModuleId.Id; readonly root: string }> = [];
        for (const entry of sortedEntries(yield* current)) {
          if (
            (entry.flags.stale && !includeStale) ||
            Option.isNone(entry.root) ||
            Option.isNone(entry.contentHash)
          )
            continue;
          if (entry.status !== "loaded" && entry.status !== "failed") continue;
          // Shipped and installed folders never change in place; only local and linked do.
          if (!Option.exists(entry.source, (source) => source === "local" || source === "linked"))
            continue;
          const root = entry.root.value;
          if (
            Option.isSome(changed) &&
            ![...changed.value].some(
              (dir) => platform.isWithin(dir, root) || platform.isWithin(root, dir),
            )
          )
            continue;
          const hash = yield* platform.hashFolder(root);
          if (Option.isNone(hash)) continue;
          if (hash.value !== entry.contentHash.value) {
            yield* markStale(entry.id);
            changedIds.push({ id: entry.id, root });
          } else if (includeStale && entry.flags.stale)
            // Back to the loaded content, e.g. a rebuild that produced the same files.
            yield* setEntry({ ...entry, flags: { ...entry.flags, stale: false } });
        }
        return changedIds;
      });

    const handleChanges = (changed: ReadonlySet<string>) =>
      locked(
        Effect.gen(function* () {
          for (const id of platform.watch?.staleWithoutHash(changed) ?? []) yield* markStale(id);
          const autoReload = platform.watch?.autoReload === true;
          const changedIds = yield* checkStaleUnder(Option.some(changed), autoReload);
          if (!autoReload || changedIds.length === 0) return;
          // A rebuild empties the folder and writes the manifest last. Reload only once the
          // folder reads as a valid copy again, keeping the loaded version until then; the write
          // that completes it triggers another check.
          const groups = yield* scan;
          for (const { id, root } of changedIds)
            if (
              groups
                .get(id)
                ?.copies.some((copy) => Option.exists(copy.root, (value) => value === root)) ===
              true
            )
              yield* refresh(id);
        }),
      );

    const watcher = yield* FiberHandle.make<void, never>();
    const restartWatcher = Effect.gen(function* () {
      const watch = platform.watch;
      if (watch === undefined) return;
      yield* FiberHandle.run(
        watcher,
        watch.changes(yield* state.get).pipe(Stream.runForEach(handleChanges)),
      );
    });

    const rescan = Effect.gen(function* () {
      const groups = yield* scan;
      const value = yield* state.get;
      for (const entry of sortedEntries(yield* current)) {
        if (groups.has(entry.id)) continue;
        yield* unloadEntry(entry);
        yield* removeEntry(entry.id);
      }
      const ids = [...groups.keys()].sort();
      for (const id of ids) {
        const group = groups.get(id);
        if (group === undefined) continue;
        const selection = VersionSelection.select(group, supportedApis);
        const existing = yield* lookup(id);
        const enabled = ModuleState.isEnabled(value, id);
        if (existing === undefined) {
          yield* attempt(id, selection, enabled);
          continue;
        }
        if (existing.status !== "loaded" && existing.status !== "failed") {
          yield* setEntry(yield* describe(id, selection, existing.enabled));
          continue;
        }
        const stale = yield* Option.match(selection.chosen, {
          onNone: () => Effect.succeed(true),
          onSome: (copy) =>
            sameCopy(existing, copy)
              ? Effect.map(
                  Effect.option(platform.contentHash(copy)),
                  (hash) =>
                    !Option.isSome(hash) || !Option.contains(existing.contentHash, hash.value),
                )
              : Effect.succeed(true),
        });
        yield* setEntry({
          ...existing,
          copies: selection.copies,
          flags: {
            ...existing.flags,
            stale,
            incompatibleInstalled: selection.incompatibleInstalled,
          },
        });
      }
      return yield* current;
    });

    // Folders created since the watcher started (a new link, `local/` itself) are picked up.
    const rescanAndWatch = Effect.tap(rescan, () => restartWatcher);

    // Startup: scan everything and load every enabled module. Failures stay on their entries.
    yield* locked(rescanAndWatch);

    return Service.of({
      entries: current,
      get: (id) => Effect.map(lookup(id), Option.fromNullishOr),
      changes: SubscriptionRef.changes(ref),
      load: (id) =>
        locked(
          Effect.gen(function* () {
            const existing = yield* lookup(id);
            if (existing !== undefined && Option.isSome(existing.loaded)) return existing;
            return yield* Effect.flatMap(refresh(id), (entry) =>
              Option.match(entry, {
                onNone: () => Effect.fail(notFound(id)),
                onSome: Effect.succeed,
              }),
            );
          }),
        ),
      unload: (id) =>
        locked(
          Effect.flatMap(requireEntry(id), (entry) => Effect.flatMap(unloadEntry(entry), setEntry)),
        ),
      reload: (id) =>
        locked(
          Effect.flatMap(refresh(id), (entry) =>
            Option.match(entry, {
              onNone: () => Effect.fail(notFound(id)),
              onSome: Effect.succeed,
            }),
          ),
        ),
      rescan: locked(rescanAndWatch),
      setEnabled: (id, enabled) =>
        locked(
          Effect.gen(function* () {
            const entry = yield* requireEntry(id);
            yield* state.update((value) => ModuleState.setEnabled(value, id, enabled));
            if (!enabled) return yield* setEntry(yield* unloadEntry({ ...entry, enabled }));
            if (Option.isSome(entry.loaded)) return yield* setEntry({ ...entry, enabled });
            return yield* Effect.flatMap(refresh(id), (next) =>
              Option.match(next, {
                onNone: () => Effect.fail(notFound(id)),
                onSome: Effect.succeed,
              }),
            );
          }),
        ),
      link: (id, path) =>
        locked(
          Effect.gen(function* () {
            if (platform.link === undefined)
              return yield* new ModuleAdminRpc.InvalidLink({
                path,
                message: "This host can't link module folders",
              });
            const linked = platform.link(id, path);
            if (Result.isFailure(linked))
              return yield* new ModuleAdminRpc.InvalidLink({ path, message: linked.failure });
            const root = linked.success.root;
            yield* state.update((value) => ModuleState.setLink(value, id, root));
            yield* restartWatcher;
            const entry = yield* refresh(id);
            return yield* Option.match(entry, {
              onNone: () =>
                Effect.fail(
                  new ModuleAdminRpc.InvalidLink({
                    path,
                    message: "The linked folder disappeared",
                  }),
                ),
              onSome: Effect.succeed,
            });
          }),
        ),
      unlink: (id) =>
        locked(
          Effect.gen(function* () {
            if (!ModuleState.links(yield* state.get).has(id)) return yield* notFound(id);
            yield* state.update((value) => ModuleState.setLink(value, id, undefined));
            yield* restartWatcher;
            return yield* refresh(id);
          }),
        ),
      checkStale: locked(Effect.asVoid(checkStaleUnder(Option.none()))),
      refreshTrust: locked(
        Effect.gen(function* () {
          for (const entry of sortedEntries(yield* current)) {
            const manifest = Option.getOrUndefined(entry.manifest);
            const source = Option.getOrUndefined(entry.source);
            if (manifest === undefined || source === undefined) continue;
            const status = yield* trustProvider.lookup({
              id: entry.id,
              source,
              version: manifest.version,
              root: entry.root,
            });
            yield* setEntry(withTrust(entry, status));
          }
        }),
      ),
      catalog: Effect.map(current, (entries) => sortedEntries(entries).map(toCatalogEntry)),
      details: Effect.map(current, (entries) => sortedEntries(entries).map(toDetails)),
      rpcHandler: (id) => Effect.map(requireLoaded(id), (loaded) => loaded.rpc),
      staticFile: (id, kind, rest) =>
        Effect.map(requireLoaded(id), (loaded) =>
          Option.flatMap(
            Option.all([loaded.root, ModuleUrls.parseStaticPath(rest)]),
            ([root, parsed]) =>
              Option.map(platform.resolveFile(root, kind, parsed.path), (path) => ({
                path,
                immutable: ModuleUrls.isCurrentVersion(parsed.version, loaded.contentHash),
              })),
          ),
        ),
    });
  });

/** The registry as a layer, on a given platform. */
export const layerWith = (options: Options, platform: Platform) =>
  Layer.effect(Service)(make(options, platform));

export * as ModuleRegistryCore from "./ModuleRegistryCore.ts";
