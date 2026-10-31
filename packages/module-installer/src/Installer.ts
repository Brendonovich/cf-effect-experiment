import { CanonicalJson } from "@macrograph/module-registry/CanonicalJson";
import { Client } from "@macrograph/module-registry/Client";
import { Protocol } from "@macrograph/module-registry/Protocol";
import { Manifest } from "@macrograph/module/Manifest";
import {
  IncompatibleModule,
  InstallFailed,
  ModuleNotFound,
  RegistryConflict,
  RegistryError,
  RegistryNotFound,
  ReleaseNotFound,
  ReleaseUnavailable,
  UntrustedConfirmationRequired,
  VerificationFailed,
  type ModuleAdminRpc,
} from "@macrograph/module/ModuleAdminRpc";
import { ModuleId } from "@macrograph/module/ModuleId";
import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Ref,
  Result,
  Schedule,
  type Scope,
  Semaphore,
  SemVer,
  type Stream,
  SubscriptionRef,
} from "effect";
import { HttpClient } from "effect/http";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Archive } from "./Archive.ts";
import { InstallRecords } from "./InstallRecords.ts";
import * as JsonFile from "./JsonFile.ts";
import { ModuleStatus } from "./ModuleStatus.ts";
import { Registries } from "./Registries.ts";

export interface Config {
  /** The server data directory; the installer works under `<dataDir>/modules/`. */
  readonly dataDir: string;
  readonly official: Registries.OfficialRegistryConfig;
  /** Host interface versions this host can load. Defaults to `[Manifest.ApiVersion]`. */
  readonly supportedApis?: ReadonlyArray<number>;
  readonly maxTarballBytes?: number;
  readonly archiveLimits?: Archive.Limits;
}

export interface InstallRequest {
  readonly id: ModuleId.Id;
  readonly version?: string;
  /** Must be `true` to install an untrusted release. Enforced here, not just in the UI. */
  readonly acknowledgeUntrusted: boolean;
  /** Who asked for the install, recorded as the confirming admin for untrusted releases. */
  readonly actor: string;
}

export interface InstallResult {
  readonly record: InstallRecords.Record;
  /** Absolute path of the unpacked package folder. */
  readonly path: string;
  /** The record this update replaced. Its folder stays until `prune` runs. */
  readonly previous?: InstallRecords.Record;
  /** `false` when an update found nothing newer and left the install untouched. */
  readonly changed: boolean;
}

export interface CheckResult {
  readonly id: ModuleId.Id;
  readonly status: ModuleStatus.Status;
  readonly error?: string;
}

export type InstallError =
  | RegistryNotFound
  | RegistryError
  | ReleaseNotFound
  | ReleaseUnavailable
  | IncompatibleModule
  | UntrustedConfirmationRequired
  | VerificationFailed
  | InstallFailed;

export interface Interface {
  readonly listRegistries: Effect.Effect<ReadonlyArray<ModuleAdminRpc.Registry>>;
  /** Fetches the registry's metadata and pins its signing keys (trust on first use). */
  readonly addRegistry: (
    url: string,
  ) => Effect.Effect<ModuleAdminRpc.Registry, RegistryConflict | RegistryError>;
  readonly removeRegistry: (
    namespace: string,
  ) => Effect.Effect<void, RegistryNotFound | RegistryError>;
  readonly setRegistryTrusted: (
    namespace: string,
    trusted: boolean,
  ) => Effect.Effect<ModuleAdminRpc.Registry, RegistryNotFound>;
  /** Searches one registry, or every registry when `namespace` is omitted. */
  readonly search: (request: {
    readonly namespace?: string;
    readonly query: string;
  }) => Effect.Effect<
    ReadonlyArray<ModuleAdminRpc.RegistrySearchResult>,
    RegistryNotFound | RegistryError
  >;
  /** Releases with signatures that don't verify are left out. */
  readonly getPackage: (
    id: ModuleId.Id,
  ) => Effect.Effect<
    ModuleAdminRpc.RegistryPackage,
    RegistryNotFound | ModuleNotFound | RegistryError
  >;
  /** Fails with `InstallFailed` when the module is already installed; use `update`. */
  readonly install: (request: InstallRequest) => Effect.Effect<InstallResult, InstallError>;
  /** Defaults to the newest compatible active release. Untrusted releases need acknowledgement again. */
  readonly update: (
    request: InstallRequest,
  ) => Effect.Effect<InstallResult, InstallError | ModuleNotFound>;
  /** Removes every installed version's files and the install record. */
  readonly uninstall: (id: ModuleId.Id) => Effect.Effect<InstallRecords.Record, ModuleNotFound>;
  /** Removes installed versions other than the recorded one, e.g. after the host reloaded an update. */
  readonly prune: (id: ModuleId.Id) => Effect.Effect<void>;
  readonly records: Effect.Effect<ReadonlyArray<InstallRecords.Record>>;
  /**
   * Checks registries for every installed module: updates `updateAvailable`, the current trust
   * and `revoked`. Failures are recorded per module and never fail the whole check.
   */
  readonly checkForUpdates: Effect.Effect<ReadonlyArray<CheckResult>>;
  /** Runs `checkForUpdates` now and then on an interval (daily by default) for the scope's life. */
  readonly scheduleChecks: (options?: {
    readonly interval?: Duration.Input;
  }) => Effect.Effect<void, never, Scope.Scope>;
  /** Per-module flags and trust, for the module host to merge into its catalog. */
  readonly statuses: Effect.Effect<ModuleStatus.Statuses>;
  readonly statusChanges: Stream.Stream<ModuleStatus.Statuses>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@macrograph/module-installer/Installer",
) {}

const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

const parseVersion = (version: string) =>
  Option.getOrUndefined(Result.getSuccess(SemVer.parse(version)));

const compareVersions = (left: string, right: string) => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === undefined || b === undefined) return 0;
  return SemVer.Order(a, b);
};

const isStable = (version: string) => {
  const parsed = parseVersion(version);
  return parsed !== undefined && !SemVer.isPrerelease(parsed);
};

const newest = (releases: ReadonlyArray<Protocol.Release>) =>
  releases.reduce<Protocol.Release | undefined>(
    (best, release) =>
      best === undefined || compareVersions(release.version, best.version) > 0 ? release : best,
    undefined,
  );

const now = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis).toISOString());

const fs = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => new Error(describe(cause)) });

export const layer = (
  config: Config,
): Layer.Layer<Service, JsonFile.JsonFileError, HttpClient.HttpClient> =>
  Layer.effect(Service)(
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const { dataDir } = config;
      const supportedApis = config.supportedApis ?? [Manifest.ApiVersion];
      const isSupported = (api: number) => supportedApis.includes(api);

      const registriesFile = JsonFile.make(
        InstallRecords.registriesPath(dataDir),
        Registries.File,
        Registries.emptyFile,
      );
      const installsFile = JsonFile.make(
        InstallRecords.filePath(dataDir),
        InstallRecords.File,
        InstallRecords.emptyFile,
      );
      const registries = yield* Ref.make(yield* registriesFile.read);
      const installs = yield* Ref.make(yield* installsFile.read);
      const lock = yield* Semaphore.make(1);

      const computeStatuses = (
        registriesValue: Registries.File,
        installsValue: InstallRecords.File,
      ): ModuleStatus.Statuses =>
        new Map(
          installsValue.installs.map((record) => [
            record.id,
            ModuleStatus.fromRecord(
              record,
              InstallRecords.versionDirectory(dataDir, record.id, record.version),
              Registries.find(config.official, registriesValue, ModuleId.namespace(record.id))
                ?.trusted,
            ),
          ]),
        );

      const statuses = yield* SubscriptionRef.make(
        computeStatuses(yield* Ref.get(registries), yield* Ref.get(installs)),
      );
      const publishStatuses = Effect.gen(function* () {
        yield* SubscriptionRef.set(
          statuses,
          computeStatuses(yield* Ref.get(registries), yield* Ref.get(installs)),
        );
      });

      const saveRegistries = (file: Registries.File) =>
        registriesFile
          .write(file)
          .pipe(Effect.andThen(Ref.set(registries, file)), Effect.andThen(publishStatuses));
      const saveInstalls = (file: InstallRecords.File) =>
        installsFile
          .write(file)
          .pipe(Effect.andThen(Ref.set(installs, file)), Effect.andThen(publishStatuses));

      const makeClient = (url: string) =>
        Client.make(
          url,
          config.maxTarballBytes === undefined ? {} : { maxTarballBytes: config.maxTarballBytes },
        ).pipe(Effect.provideService(HttpClient.HttpClient, http));

      const registryError =
        (registry: Pick<Registries.Registry, "namespace">) => (error: Client.ClientError) =>
          new RegistryError({
            namespace: registry.namespace,
            url: error.url,
            message: error.message,
          });

      const findRegistry = (namespace: string) =>
        Effect.flatMap(Ref.get(registries), (file) => {
          const registry = Registries.find(config.official, file, namespace);
          return registry === undefined
            ? Effect.fail(new RegistryNotFound({ namespace }))
            : Effect.succeed(registry);
        });

      const clientFor = (registry: Registries.Registry) =>
        makeClient(registry.url).pipe(Effect.mapError(registryError(registry)));

      const installedVersion = (file: InstallRecords.File, id: ModuleId.Id) =>
        InstallRecords.find(file, id)?.version;

      // Registries

      const listRegistries = Effect.map(Ref.get(registries), (file) =>
        Registries.all(config.official, file).map(Registries.toPayload),
      );

      const addRegistry = (url: string) =>
        lock.withPermit(
          Effect.gen(function* () {
            const client = yield* makeClient(url).pipe(
              Effect.mapError((error) => new RegistryError({ url, message: error.message })),
            );
            const metadata = yield* client.metadata.pipe(
              Effect.mapError(
                (error) => new RegistryError({ url: client.url, message: error.message }),
              ),
            );
            if (metadata.keys.length === 0)
              return yield* new RegistryError({
                namespace: metadata.namespace,
                url: client.url,
                message: "The registry publishes no signing keys",
              });
            const file = yield* Ref.get(registries);
            if (Registries.find(config.official, file, metadata.namespace) !== undefined)
              return yield* new RegistryConflict({
                namespace: metadata.namespace,
                url: client.url,
              });
            const stored: Registries.StoredRegistry = {
              namespace: metadata.namespace,
              url: client.url,
              displayName: metadata.displayName,
              trusted: false,
              keys: metadata.keys,
              addedAt: yield* now,
            };
            yield* saveRegistries({ ...file, registries: [...file.registries, stored] }).pipe(
              Effect.mapError(
                (error) =>
                  new RegistryError({
                    namespace: metadata.namespace,
                    url: client.url,
                    message: error.message,
                  }),
              ),
            );
            return Registries.toPayload({ ...stored, official: false });
          }),
        );

      const removeRegistry = (namespace: string) =>
        lock.withPermit(
          Effect.gen(function* () {
            const registry = yield* findRegistry(namespace);
            if (registry.official)
              return yield* new RegistryError({
                namespace,
                message: "The official registry can't be removed",
              });
            const file = yield* Ref.get(registries);
            yield* saveRegistries({
              ...file,
              registries: file.registries.filter((stored) => stored.namespace !== namespace),
            }).pipe(
              Effect.mapError((error) => new RegistryError({ namespace, message: error.message })),
            );
          }),
        );

      const setRegistryTrusted = (namespace: string, trusted: boolean) =>
        lock.withPermit(
          Effect.gen(function* () {
            const registry = yield* findRegistry(namespace);
            const file = yield* Ref.get(registries);
            const next: Registries.File = registry.official
              ? { ...file, officialTrusted: trusted }
              : {
                  ...file,
                  registries: file.registries.map((stored) =>
                    stored.namespace === namespace ? { ...stored, trusted } : stored,
                  ),
                };
            yield* saveRegistries(next).pipe(Effect.orDie);
            return Registries.toPayload({ ...registry, trusted });
          }),
        );

      const searchOne = (registry: Registries.Registry, query: string) =>
        Effect.gen(function* () {
          const client = yield* clientFor(registry);
          const entries = yield* client
            .search(query)
            .pipe(Effect.mapError(registryError(registry)));
          const file = yield* Ref.get(installs);
          return entries.flatMap((entry): Array<ModuleAdminRpc.RegistrySearchResult> => {
            const id = Option.getOrUndefined(
              ModuleId.parse(
                ModuleId.format({
                  namespace: registry.namespace,
                  publisher: entry.publisher,
                  name: entry.name,
                }),
              ),
            );
            if (id === undefined) return [];
            const installed = installedVersion(file, id);
            return [
              {
                id,
                displayName: entry.displayName,
                ...(entry.description === undefined ? {} : { description: entry.description }),
                latestVersion: entry.latestVersion,
                ...(installed === undefined ? {} : { installedVersion: installed }),
              },
            ];
          });
        });

      const search = (request: { readonly namespace?: string; readonly query: string }) =>
        request.namespace !== undefined
          ? Effect.flatMap(findRegistry(request.namespace), (registry) =>
              searchOne(registry, request.query),
            )
          : Effect.gen(function* () {
              const all = Registries.all(config.official, yield* Ref.get(registries));
              const results = yield* Effect.forEach(
                all,
                (registry) => Effect.result(searchOne(registry, request.query)),
                { concurrency: "unbounded" },
              );
              const successes = results.flatMap((result) =>
                Result.isSuccess(result) ? [result.success] : [],
              );
              const firstFailure = results.find(Result.isFailure);
              if (successes.length === 0 && firstFailure !== undefined)
                return yield* firstFailure.failure;
              return successes.flat();
            });

      const fetchPackage = (registry: Registries.Registry, id: ModuleId.Id) =>
        Effect.gen(function* () {
          const client = yield* clientFor(registry);
          const pkg = yield* client.getPackage(ModuleId.publisher(id), ModuleId.name(id)).pipe(
            Effect.catchTag("RegistryPackageNotFound", () =>
              Effect.fail(new ModuleNotFound({ id })),
            ),
            Effect.mapError((error) =>
              error._tag === "RegistryClientError" ? registryError(registry)(error) : error,
            ),
          );
          return { client, pkg };
        });

      const getPackage = (id: ModuleId.Id) =>
        Effect.gen(function* () {
          const registry = yield* findRegistry(ModuleId.namespace(id));
          const { pkg } = yield* fetchPackage(registry, id);
          const verified = yield* Effect.filter(pkg.releases, (release) =>
            Client.verifySignature(registry.keys, registry.namespace, pkg, release).pipe(
              Effect.as(true),
              Effect.catch(() => Effect.succeed(false)),
            ),
          );
          const sorted = [...verified].sort((a, b) => compareVersions(b.version, a.version));
          const latest = sorted.find((release) => release.status === "active") ?? sorted[0];
          const installed = installedVersion(yield* Ref.get(installs), id);
          return {
            id,
            displayName: latest?.manifest.displayName ?? pkg.name,
            ...(latest?.manifest.description === undefined
              ? {}
              : { description: latest.manifest.description }),
            ...(installed === undefined ? {} : { installedVersion: installed }),
            releases: sorted.map((release) => ({
              version: release.version,
              api: release.api,
              compatible: isSupported(release.api),
              publishedAt: release.publishedAt,
              trust: Registries.effectiveTrust(registry, release.trust),
              status: release.status,
              ...(release.reason === undefined ? {} : { reason: release.reason }),
              requires: release.manifest.requires ?? [],
              node: release.manifest.node ?? [],
              native: release.manifest.native ?? [],
            })),
          } satisfies ModuleAdminRpc.RegistryPackage;
        });

      // Installing

      const selectRelease = (
        id: ModuleId.Id,
        pkg: Protocol.Package,
        version: string | undefined,
      ): Effect.Effect<
        Protocol.Release,
        ReleaseNotFound | ReleaseUnavailable | IncompatibleModule
      > => {
        if (version !== undefined) {
          const release = pkg.releases.find((candidate) => candidate.version === version);
          return release === undefined
            ? Effect.fail(new ReleaseNotFound({ id, version }))
            : Effect.succeed(release);
        }
        const stable = pkg.releases.filter((release) => isStable(release.version));
        const active = stable.filter((release) => release.status === "active");
        const compatible = newest(active.filter((release) => isSupported(release.api)));
        if (compatible !== undefined) return Effect.succeed(compatible);
        const fallback = newest(active) ?? newest(stable);
        return fallback === undefined
          ? Effect.fail(new ReleaseNotFound({ id }))
          : Effect.succeed(fallback);
      };

      const verificationFailed =
        (id: ModuleId.Id, version: string) => (error: Client.ReleaseVerificationFailed) =>
          new VerificationFailed({ id, version, check: error.check, message: error.message });

      const installFailed = (id: ModuleId.Id) => (cause: unknown) =>
        new InstallFailed({
          id,
          message:
            cause instanceof Archive.UnsafeArchive
              ? `Unsafe archive entry "${cause.entry}": ${cause.message}`
              : describe(cause),
        });

      const checkManifest = (
        id: ModuleId.Id,
        release: Protocol.Release,
        entries: ReadonlyArray<Archive.Entry>,
      ) =>
        Effect.gen(function* () {
          const fail = (message: string) =>
            new VerificationFailed({ id, version: release.version, check: "manifest", message });
          const entry = entries.find((candidate) => candidate.path === "macrograph.json");
          if (entry?.data === undefined) return yield* fail("The package has no macrograph.json");
          const manifest = yield* Manifest.decodeJson(new TextDecoder().decode(entry.data)).pipe(
            Effect.mapError((error) => fail(`Invalid macrograph.json: ${error.message}`)),
          );
          if (
            manifest.publisher !== ModuleId.publisher(id) ||
            manifest.name !== ModuleId.name(id) ||
            manifest.version !== release.version ||
            manifest.api !== release.api
          )
            return yield* fail("macrograph.json doesn't match the release");
          if (CanonicalJson.stringify(manifest) !== CanonicalJson.stringify(release.manifest))
            return yield* fail("macrograph.json differs from the manifest the registry listed");
          return manifest;
        });

      /** Resolves, checks, downloads, verifies and unpacks a release, then records it. */
      const performInstall = (
        request: InstallRequest,
        previous: InstallRecords.Record | undefined,
      ) =>
        Effect.gen(function* () {
          const { id } = request;
          const registry = yield* findRegistry(ModuleId.namespace(id));
          const { client, pkg } = yield* fetchPackage(registry, id).pipe(
            Effect.catchTag("ModuleNotFound", () => Effect.fail(new ReleaseNotFound({ id }))),
          );
          const release = yield* selectRelease(id, pkg, request.version);
          const fail = verificationFailed(id, release.version);

          yield* Client.verifySignature(registry.keys, registry.namespace, pkg, release).pipe(
            Effect.mapError(fail),
          );
          if (!isSupported(release.api))
            return yield* new IncompatibleModule({
              id,
              version: release.version,
              api: release.api,
              supported: supportedApis,
            });
          if (release.status !== "active")
            return yield* new ReleaseUnavailable({
              id,
              version: release.version,
              status: release.status,
              ...(release.reason === undefined ? {} : { reason: release.reason }),
            });
          if (previous !== undefined && previous.version === release.version)
            return {
              record: previous,
              path: InstallRecords.versionDirectory(dataDir, id, previous.version),
              previous,
              changed: false,
            } satisfies InstallResult;

          const trust = Registries.effectiveTrust(registry, release.trust);
          if (trust === "untrusted" && request.acknowledgeUntrusted !== true)
            return yield* new UntrustedConfirmationRequired({
              id,
              version: release.version,
              registry: registry.namespace,
              requires: release.manifest.requires ?? [],
              node: release.manifest.node ?? [],
              native: release.manifest.native ?? [],
            });

          const bytes = yield* client
            .download(release)
            .pipe(Effect.mapError(registryError(registry)));
          yield* Client.verifyIntegrity(pkg, release, bytes).pipe(Effect.mapError(fail));
          const entries = yield* Archive.read(bytes, config.archiveLimits).pipe(
            Effect.mapError(installFailed(id)),
          );
          yield* checkManifest(id, release, entries);

          const target = InstallRecords.versionDirectory(dataDir, id, release.version);
          const staging = join(InstallRecords.stagingDirectory(dataDir), crypto.randomUUID());
          yield* Archive.extract(entries, staging).pipe(
            Effect.mapError(installFailed(id)),
            Effect.andThen(
              fs(async () => {
                await mkdir(dirname(target), { recursive: true });
                await rm(target, { recursive: true, force: true });
                await rename(staging, target);
              }).pipe(Effect.mapError(installFailed(id))),
            ),
            Effect.ensuring(Effect.promise(() => rm(staging, { recursive: true, force: true }))),
          );

          const at = yield* now;
          const record: InstallRecords.Record = {
            id,
            version: release.version,
            api: release.api,
            integrity: release.integrity,
            trust,
            declaredTrust: release.trust,
            installedBy: request.actor,
            installedAt: at,
            ...(trust === "untrusted" ? { confirmation: { actor: request.actor, at } } : {}),
            check: {
              checkedAt: at,
              declaredTrust: release.trust,
              status: release.status,
              ...(release.reason === undefined ? {} : { reason: release.reason }),
            },
          };
          yield* saveInstalls(InstallRecords.upsert(yield* Ref.get(installs), record)).pipe(
            Effect.mapError(installFailed(id)),
          );
          return {
            record,
            path: target,
            ...(previous === undefined ? {} : { previous }),
            changed: true,
          } satisfies InstallResult;
        });

      const install = (request: InstallRequest) =>
        lock.withPermit(
          Effect.gen(function* () {
            if (InstallRecords.find(yield* Ref.get(installs), request.id) !== undefined)
              return yield* new InstallFailed({
                id: request.id,
                message: "The module is already installed; update it instead",
              });
            return yield* performInstall(request, undefined);
          }),
        );

      const update = (request: InstallRequest) =>
        lock.withPermit(
          Effect.gen(function* () {
            const previous = InstallRecords.find(yield* Ref.get(installs), request.id);
            if (previous === undefined) return yield* new ModuleNotFound({ id: request.id });
            return yield* performInstall(request, previous);
          }),
        );

      const uninstall = (id: ModuleId.Id) =>
        lock.withPermit(
          Effect.gen(function* () {
            const file = yield* Ref.get(installs);
            const record = InstallRecords.find(file, id);
            if (record === undefined) return yield* new ModuleNotFound({ id });
            yield* fs(() =>
              rm(InstallRecords.moduleDirectory(dataDir, id), { recursive: true, force: true }),
            ).pipe(Effect.orDie);
            yield* saveInstalls(InstallRecords.remove(file, id)).pipe(Effect.orDie);
            return record;
          }),
        );

      const prune = (id: ModuleId.Id) =>
        lock.withPermit(
          Effect.gen(function* () {
            const record = InstallRecords.find(yield* Ref.get(installs), id);
            const directory = InstallRecords.moduleDirectory(dataDir, id);
            yield* fs(async () => {
              const versions = await readdir(directory).catch(() => []);
              await Promise.all(
                versions
                  .filter((version) => version !== record?.version)
                  .map((version) => rm(join(directory, version), { recursive: true, force: true })),
              );
            }).pipe(Effect.ignore);
          }),
        );

      // Registry checks

      const checkRecord = (
        record: InstallRecords.Record,
        file: Registries.File,
      ): Effect.Effect<InstallRecords.Check> =>
        Effect.gen(function* () {
          const checkedAt = yield* now;
          const keep = (error: string): InstallRecords.Check => ({
            ...record.check,
            checkedAt,
            error,
          });
          const registry = Registries.find(config.official, file, ModuleId.namespace(record.id));
          if (registry === undefined) return keep("The registry is no longer configured");
          const fetched = yield* Effect.result(fetchPackage(registry, record.id));
          if (Result.isFailure(fetched))
            return keep(
              fetched.failure._tag === "ModuleNotFound"
                ? "The registry no longer lists this module"
                : fetched.failure.message,
            );
          const { pkg } = fetched.success;
          const verified = (release: Protocol.Release) =>
            Client.verifySignature(registry.keys, registry.namespace, pkg, release).pipe(
              Effect.as(true),
              Effect.catch(() => Effect.succeed(false)),
            );
          const release = pkg.releases.find((candidate) => candidate.version === record.version);
          if (release === undefined) return keep("The registry no longer lists this release");
          if (!(yield* verified(release))) return keep("The release record's signature is invalid");
          const candidate = newest(
            pkg.releases.filter(
              (other) =>
                other.status === "active" &&
                isStable(other.version) &&
                isSupported(other.api) &&
                compareVersions(other.version, record.version) > 0,
            ),
          );
          const update =
            candidate !== undefined && (yield* verified(candidate)) ? candidate.version : undefined;
          return {
            checkedAt,
            declaredTrust: release.trust,
            status: release.status,
            ...(release.reason === undefined ? {} : { reason: release.reason }),
            ...(update === undefined ? {} : { updateVersion: update }),
          };
        });

      const checkForUpdates = Effect.gen(function* () {
        const registriesValue = yield* Ref.get(registries);
        const records = (yield* Ref.get(installs)).installs;
        const checks = yield* Effect.forEach(
          records,
          (record) =>
            Effect.map(checkRecord(record, registriesValue), (check) => ({ record, check })),
          { concurrency: 4 },
        );
        if (checks.length > 0)
          yield* lock.withPermit(
            Effect.gen(function* () {
              const current = yield* Ref.get(installs);
              const next: InstallRecords.File = {
                ...current,
                installs: current.installs.map((record) => {
                  const result = checks.find(
                    (candidate) =>
                      candidate.record.id === record.id &&
                      candidate.record.version === record.version,
                  );
                  return result === undefined ? record : { ...record, check: result.check };
                }),
              };
              yield* saveInstalls(next).pipe(
                Effect.catch((error) =>
                  Effect.logWarning("Could not save module registry check results", error.message),
                ),
              );
            }),
          );
        const current = yield* SubscriptionRef.get(statuses);
        return checks.flatMap(({ record, check }): Array<CheckResult> => {
          const status = current.get(record.id);
          if (status === undefined) return [];
          return [
            { id: record.id, status, ...(check.error === undefined ? {} : { error: check.error }) },
          ];
        });
      });

      const scheduleChecks = (options?: { readonly interval?: Duration.Input }) =>
        checkForUpdates.pipe(
          Effect.repeat(Schedule.spaced(options?.interval ?? Duration.days(1))),
          Effect.forkScoped,
          Effect.asVoid,
        );

      return {
        listRegistries,
        addRegistry,
        removeRegistry,
        setRegistryTrusted,
        search,
        getPackage,
        install,
        update,
        uninstall,
        prune,
        records: Effect.map(Ref.get(installs), (file) => file.installs),
        checkForUpdates,
        scheduleChecks,
        statuses: SubscriptionRef.get(statuses),
        statusChanges: SubscriptionRef.changes(statuses),
      } satisfies Interface;
    }),
  );

export * as Installer from "./Installer.ts";
