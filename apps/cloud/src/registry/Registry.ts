import { Integrity } from "@macrograph/module-registry/Integrity";
import { Protocol } from "@macrograph/module-registry/Protocol";
import { ModuleId } from "@macrograph/module/ModuleId";
import { ApiKey } from "@macrograph/project-api";
import { Context, Effect, Layer, Option, Result, SemVer } from "effect";

import type {
  PublisherRecord,
  PublisherStatus,
  ReleaseRecord,
  PackageRecord,
} from "./RegistrySchema.ts";

import {
  AccountNotFound,
  InvalidPackage,
  InvalidRequest,
  NotAdmin,
  PackageNotFound,
  PublisherNameUnavailable,
  PublisherNotApproved,
  PublisherNotFound,
  PublisherNotOwned,
  ReleaseNotFound,
  Unauthorized,
  VersionExists,
} from "./Errors.ts";
import * as PackageChecks from "./PackageChecks.ts";
import * as RegistryConfig from "./RegistryConfig.ts";
import * as RegistrySigner from "./RegistrySigner.ts";
import * as RegistryStore from "./RegistryStore.ts";
import * as Tarball from "./Tarball.ts";
import * as TarballStore from "./TarballStore.ts";

/** The authenticated MacroGraph account making a request. */
export interface Actor {
  readonly userId: string;
  readonly email: string | null;
}

export const tarballPath = (publisher: string, name: string, version: string) =>
  `/v1/tarballs/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}.tgz`;

export interface PublisherView {
  readonly name: string;
  readonly ownerUserId: string;
  readonly status: PublisherStatus;
  readonly trusted: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PublisherUpdate {
  /** Owner account (user id or email). Required when creating a publisher. */
  readonly account?: string;
  readonly status?: PublisherStatus;
  readonly trusted?: boolean;
}

export interface ReleaseUpdate {
  /** `null` clears the override so the release inherits the publisher's trust. */
  readonly trust?: Protocol.Trust | null;
  readonly status?: Protocol.ReleaseStatus;
  readonly reason?: string;
}

/** The integrity digest as a URL- and key-safe string. */
const digestKey = (integrity: string) =>
  integrity.slice("sha256-".length).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const parseVersion = (version: string) => Result.getOrUndefined(SemVer.parse(version));

const compareVersions = (left: string, right: string) => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === undefined || b === undefined) return left < right ? -1 : left > right ? 1 : 0;
  return SemVer.Order(a, b);
};

const latestVersion = (
  releases: ReadonlyArray<Pick<ReleaseRecord, "version" | "status">>,
): string | undefined => {
  const active = releases.filter((release) => release.status === "active");
  const candidates = active.length > 0 ? active : releases;
  return candidates
    .map((release) => release.version)
    .reduce<string | undefined>(
      (latest, version) =>
        latest === undefined || compareVersions(version, latest) > 0 ? version : latest,
      undefined,
    );
};

const effectiveTrust = (
  publisher: Pick<PublisherRecord, "trusted">,
  release: Pick<ReleaseRecord, "trustOverride">,
): Protocol.Trust => release.trustOverride ?? (publisher.trusted ? "trusted" : "untrusted");

const publisherView = (record: PublisherRecord): PublisherView => ({
  name: record.name,
  ownerUserId: record.ownerUserId,
  status: record.status,
  trusted: record.trusted,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const matchesAccount = (actor: Actor, account: string) => {
  const normalized = account.trim().toLowerCase();
  return (
    actor.userId === account || (actor.email !== null && actor.email.toLowerCase() === normalized)
  );
};

/** Extra publish-time checks; defaults to {@link PackageChecks.bundleChecks}. */
export class Checks extends Context.Service<Checks, ReadonlyArray<PackageChecks.Check>>()(
  "macrograph/cloudflare/RegistryChecks",
) {}

export const make = Effect.gen(function* () {
  const config = yield* RegistryConfig.Service;
  const store = yield* RegistryStore.Service;
  const tarballs = yield* TarballStore.Service;
  const signer = yield* RegistrySigner.Service;
  const checks = yield* Effect.serviceOption(Checks).pipe(
    Effect.map(Option.getOrElse(() => PackageChecks.bundleChecks)),
  );

  const now = () => new Date().toISOString();

  const toRelease = (
    origin: string,
    pkg: PackageRecord,
    release: ReleaseRecord,
  ): Protocol.Release => ({
    version: release.version,
    api: release.api,
    publishedAt: release.publishedAt,
    manifest: release.manifest,
    tarball: `${Option.getOrElse(config.publicOrigin, () => origin)}${tarballPath(pkg.publisher, pkg.name, release.version)}`,
    integrity: release.integrity,
    trust: release.signedRecord.trust,
    status: release.signedRecord.status,
    ...(release.reason === null ? {} : { reason: release.reason }),
    signature: release.signature,
  });

  /** Seed publishers from configuration are created, approved, on first use. */
  const findPublisher = (name: string) =>
    Effect.gen(function* () {
      const existing = yield* store.getPublisher(name);
      if (Option.isSome(existing)) return existing;
      const seed = config.seedPublishers.find((candidate) => candidate.name === name);
      if (seed === undefined) return Option.none<PublisherRecord>();
      const account = yield* store.findAccount(seed.account);
      if (Option.isNone(account)) return Option.none<PublisherRecord>();
      const timestamp = now();
      yield* store.insertPublisher({
        name,
        ownerUserId: account.value.id,
        status: "approved",
        trusted: seed.trusted,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      return yield* store.getPublisher(name);
    });

  const isAdmin = (actor: Actor) => config.admins.some((account) => matchesAccount(actor, account));

  const requireAdmin = (actor: Actor) =>
    isAdmin(actor)
      ? Effect.void
      : Effect.fail(new NotAdmin({ message: "Only registry admins can do this" }));

  const resign = (publisher: PublisherRecord, pkg: PackageRecord, release: ReleaseRecord) =>
    Effect.gen(function* () {
      const signedRecord = Protocol.signedRecord(config.namespace, pkg, {
        version: release.version,
        api: release.api,
        integrity: release.integrity,
        trust: effectiveTrust(publisher, release),
        status: release.status,
      });
      const signature = yield* signer.sign(signedRecord);
      yield* store.updateRelease(release.id, { signedRecord, signature });
      return { ...release, signedRecord, signature };
    });

  const loadPackage = (publisher: string, name: string) =>
    Effect.flatMap(store.getPackage(publisher, name), (pkg) =>
      Option.match(pkg, {
        onNone: () =>
          Effect.fail(
            new PackageNotFound({ message: `Package ${publisher}/${name} was not found` }),
          ),
        onSome: Effect.succeed,
      }),
    );

  const loadRelease = (publisher: string, name: string, version: string) =>
    Effect.gen(function* () {
      const pkg = yield* loadPackage(publisher, name).pipe(
        Effect.mapError(({ message }) => new ReleaseNotFound({ message })),
      );
      const release = yield* store.getRelease(pkg.id, version);
      if (Option.isNone(release))
        return yield* new ReleaseNotFound({
          message: `Release ${publisher}/${name}@${version} was not found`,
        });
      return { pkg, release: release.value };
    });

  const index = Effect.gen(function* () {
    const [packages, versions] = yield* Effect.all([store.listPackages, store.listReleaseVersions]);
    const byPackage = Map.groupBy(versions, (release) => release.packageId);
    const entries: Array<Protocol.IndexEntry> = [];
    for (const pkg of packages) {
      const latest = latestVersion(byPackage.get(pkg.id) ?? []);
      if (latest === undefined) continue;
      entries.push({
        publisher: pkg.publisher,
        name: pkg.name,
        displayName: pkg.displayName,
        ...(pkg.description === null ? {} : { description: pkg.description }),
        latestVersion: latest,
      });
    }
    return { packages: entries } satisfies Protocol.Index;
  });

  const authenticate = (authorization: string | undefined) =>
    Effect.gen(function* () {
      const key = ApiKey.fromAuthorization(authorization);
      if (key === undefined)
        return yield* new Unauthorized({ message: "A MacroGraph API token is required" });
      const account = yield* store.findApiKeyAccount(yield* ApiKey.hash(key));
      if (Option.isNone(account))
        return yield* new Unauthorized({ message: "The API token is not valid" });
      return { userId: account.value.id, email: account.value.email } satisfies Actor;
    });

  const publish = (actor: Actor, tgz: Uint8Array<ArrayBuffer>, origin: string) =>
    Effect.gen(function* () {
      if (tgz.byteLength > config.limits.maxTarballBytes)
        return yield* new InvalidPackage({
          message: "The tarball is too large",
          problems: [`The tarball exceeds ${config.limits.maxTarballBytes} bytes`],
        });
      const entries = yield* Tarball.read(tgz, config.limits).pipe(
        Effect.mapError(
          (error) =>
            new InvalidPackage({
              message: "The tarball could not be read",
              problems: [error.message],
            }),
        ),
      );
      const { manifest } = yield* PackageChecks.inspect(entries, {
        supportedApi: config.supportedApi,
        checks,
      });

      const publisher = yield* findPublisher(manifest.publisher);
      if (Option.isNone(publisher) || publisher.value.ownerUserId !== actor.userId)
        return yield* new PublisherNotOwned({
          publisher: manifest.publisher,
          message: `You do not own the publisher ${manifest.publisher}`,
        });
      if (publisher.value.status !== "approved")
        return yield* new PublisherNotApproved({
          publisher: manifest.publisher,
          status: publisher.value.status,
          message: `The publisher ${manifest.publisher} is ${publisher.value.status}`,
        });

      const timestamp = now();
      const pkg = yield* store.ensurePackage({
        id: crypto.randomUUID(),
        publisher: manifest.publisher,
        name: manifest.name,
        displayName: manifest.displayName,
        description: manifest.description ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const versionTaken = () =>
        new VersionExists({
          message: `${manifest.publisher}/${manifest.name}@${manifest.version} is already published`,
        });
      if (Option.isSome(yield* store.getRelease(pkg.id, manifest.version)))
        return yield* versionTaken();

      const integrity = yield* Integrity.compute(tgz).pipe(Effect.orDie);
      // The key includes the digest, so a racing publish can never overwrite a stored tarball.
      const tarballKey = `tarballs/${pkg.publisher}/${pkg.name}/${manifest.version}/${digestKey(integrity)}.tgz`;
      const signedRecord = Protocol.signedRecord(config.namespace, pkg, {
        version: manifest.version,
        api: manifest.api,
        integrity,
        trust: effectiveTrust(publisher.value, { trustOverride: null }),
        status: "active",
      });
      const signed: ReleaseRecord = {
        id: crypto.randomUUID(),
        packageId: pkg.id,
        version: manifest.version,
        api: manifest.api,
        manifest,
        integrity,
        tarballKey,
        trustOverride: null,
        status: "active",
        reason: null,
        signedRecord,
        signature: yield* signer.sign(signedRecord),
        publishedBy: actor.userId,
        publishedAt: timestamp,
      };

      yield* tarballs.put(tarballKey, tgz);
      if (!(yield* store.insertRelease(signed))) {
        const existing = yield* store.getRelease(pkg.id, manifest.version);
        if (Option.isSome(existing) && existing.value.tarballKey !== tarballKey)
          yield* tarballs.delete(tarballKey);
        return yield* versionTaken();
      }

      const latest = latestVersion(yield* store.listReleases(pkg.id));
      if (latest === signed.version)
        yield* store.updatePackage(pkg.id, {
          displayName: manifest.displayName,
          description: manifest.description ?? null,
          updatedAt: timestamp,
        });
      return toRelease(origin, pkg, signed);
    });

  const applyForPublisher = (actor: Actor, name: string) =>
    Effect.gen(function* () {
      if (!ModuleId.isSegment(name))
        return yield* new InvalidRequest({ message: `${name} is not a valid publisher name` });
      const seeded = yield* findPublisher(name);
      if (Option.isSome(seeded)) {
        if (seeded.value.ownerUserId === actor.userId) return publisherView(seeded.value);
        return yield* new PublisherNameUnavailable({
          publisher: name,
          message: `The publisher name ${name} is taken`,
        });
      }
      if (
        ModuleId.isReservedPublisher(name) ||
        config.seedPublishers.some((seed) => seed.name === name)
      )
        return yield* new PublisherNameUnavailable({
          publisher: name,
          message: `The publisher name ${name} is reserved`,
        });
      const timestamp = now();
      const record: PublisherRecord = {
        name,
        ownerUserId: actor.userId,
        status: "pending",
        trusted: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      if (!(yield* store.insertPublisher(record)))
        return yield* new PublisherNameUnavailable({
          publisher: name,
          message: `The publisher name ${name} is taken`,
        });
      return publisherView(record);
    });

  const listPublishers = (actor: Actor) =>
    Effect.gen(function* () {
      yield* requireAdmin(actor);
      yield* Effect.forEach(config.seedPublishers, (seed) => findPublisher(seed.name), {
        discard: true,
      });
      return (yield* store.listPublishers).map(publisherView);
    });

  const resignPublisher = (publisher: PublisherRecord) =>
    Effect.gen(function* () {
      const packages = (yield* store.listPackages).filter(
        (pkg) => pkg.publisher === publisher.name,
      );
      yield* Effect.forEach(
        packages,
        (pkg) =>
          Effect.flatMap(store.listReleases(pkg.id), (releases) =>
            Effect.forEach(
              releases.filter(
                (release) => release.signedRecord.trust !== effectiveTrust(publisher, release),
              ),
              (release) => resign(publisher, pkg, release),
              { discard: true },
            ),
          ),
        { discard: true },
      );
    });

  const updatePublisher = (actor: Actor, name: string, update: PublisherUpdate) =>
    Effect.gen(function* () {
      yield* requireAdmin(actor);
      if (!ModuleId.isSegment(name))
        return yield* new InvalidRequest({ message: `${name} is not a valid publisher name` });
      const existing = yield* findPublisher(name);
      if (Option.isNone(existing)) {
        if (update.account === undefined)
          return yield* new PublisherNotFound({
            publisher: name,
            message: `The publisher ${name} does not exist; pass an account to create it`,
          });
        if (ModuleId.isReservedPublisher(name))
          return yield* new PublisherNameUnavailable({
            publisher: name,
            message: `The publisher name ${name} is reserved and can only be configured as a seed publisher`,
          });
        const account = yield* store.findAccount(update.account);
        if (Option.isNone(account))
          return yield* new AccountNotFound({
            account: update.account,
            message: `No MacroGraph account matches ${update.account}`,
          });
        const timestamp = now();
        const record: PublisherRecord = {
          name,
          ownerUserId: account.value.id,
          status: update.status ?? "approved",
          trusted: update.trusted ?? false,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        if (!(yield* store.insertPublisher(record)))
          return yield* new PublisherNameUnavailable({
            publisher: name,
            message: `The publisher name ${name} is taken`,
          });
        return publisherView(record);
      }
      if (update.account !== undefined)
        return yield* new InvalidRequest({ message: "Transferring publishers is not supported" });
      const updated = yield* store.updatePublisher(name, {
        ...(update.status === undefined ? {} : { status: update.status }),
        ...(update.trusted === undefined ? {} : { trusted: update.trusted }),
        updatedAt: now(),
      });
      const publisher = Option.getOrElse(updated, () => existing.value);
      if (publisher.trusted !== existing.value.trusted) yield* resignPublisher(publisher);
      return publisherView(publisher);
    });

  const updateRelease = (
    actor: Actor,
    publisherName: string,
    name: string,
    version: string,
    update: ReleaseUpdate,
    origin: string,
  ) =>
    Effect.gen(function* () {
      yield* requireAdmin(actor);
      const { pkg, release } = yield* loadRelease(publisherName, name, version);
      const publisher = yield* store.getPublisher(pkg.publisher);
      if (Option.isNone(publisher))
        return yield* Effect.die(`Publisher ${pkg.publisher} of a stored package is missing`);
      const status = update.status ?? release.status;
      const reason =
        update.reason !== undefined
          ? update.reason.trim() === ""
            ? null
            : update.reason.trim()
          : update.status === "active"
            ? null
            : release.reason;
      if (status !== "active" && reason === null)
        return yield* new InvalidRequest({
          message: `A reason is required to mark a release ${status}`,
        });
      const changed: ReleaseRecord = {
        ...release,
        trustOverride: update.trust === undefined ? release.trustOverride : update.trust,
        status,
        reason,
      };
      yield* store.updateRelease(release.id, {
        trustOverride: changed.trustOverride,
        status: changed.status,
        reason: changed.reason,
      });
      const signed = yield* resign(publisher.value, pkg, changed);
      return toRelease(origin, pkg, signed);
    });

  return {
    metadata: Effect.map(
      signer.key,
      (key): Protocol.Metadata => ({
        protocol: Protocol.ProtocolVersion,
        namespace: config.namespace,
        displayName: config.displayName,
        keys: [key],
      }),
    ),
    index,
    search: (query: string) =>
      Effect.map(index, (result): Protocol.Index => {
        const terms = query
          .toLowerCase()
          .split(/\s+/)
          .filter((term) => term !== "");
        return {
          packages: result.packages.filter((entry) => {
            const haystack = [
              entry.publisher,
              entry.name,
              entry.displayName,
              entry.description ?? "",
            ]
              .join(" ")
              .toLowerCase();
            return terms.every((term) => haystack.includes(term));
          }),
        };
      }),
    package: (publisher: string, name: string, origin: string) =>
      Effect.gen(function* () {
        const pkg = yield* loadPackage(publisher, name);
        const releases = yield* store.listReleases(pkg.id);
        return {
          publisher: pkg.publisher,
          name: pkg.name,
          releases: [...releases]
            .sort((left, right) => compareVersions(left.version, right.version))
            .map((release) => toRelease(origin, pkg, release)),
        } satisfies Protocol.Package;
      }),
    tarball: (publisher: string, name: string, version: string) =>
      Effect.gen(function* () {
        const { release } = yield* loadRelease(publisher, name, version);
        const bytes = yield* tarballs.get(release.tarballKey);
        if (Option.isNone(bytes))
          return yield* Effect.die(`Tarball ${release.tarballKey} is missing from storage`);
        return bytes.value;
      }),
    authenticate,
    isAdmin,
    publish,
    applyForPublisher,
    listPublishers,
    updatePublisher,
    updateRelease,
  };
});

export class Service extends Context.Service<Service, Effect.Success<typeof make>>()(
  "macrograph/cloudflare/Registry",
) {}

export const layer = Layer.effect(Service)(make);
