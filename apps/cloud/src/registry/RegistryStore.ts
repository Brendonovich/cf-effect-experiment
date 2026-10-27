import { and, eq, or, sql } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";

import * as Database from "../database/Database.ts";
import { apiKeys, users } from "../database/DatabaseSchema.ts";
import {
  registryPackages,
  registryPublishers,
  registryReleases,
  type PackageRecord,
  type PublisherRecord,
  type ReleaseRecord,
} from "./RegistrySchema.ts";

export interface Account {
  readonly id: string;
  readonly email: string | null;
}

export type PublisherPatch = Partial<Pick<PublisherRecord, "status" | "trusted" | "updatedAt">>;
export type PackagePatch = Partial<
  Pick<PackageRecord, "displayName" | "description" | "updatedAt">
>;
export type ReleasePatch = Partial<
  Pick<ReleaseRecord, "trustOverride" | "status" | "reason" | "signedRecord" | "signature">
>;

/** Persistence for the official registry. Database failures are defects. */
export interface Store {
  readonly findAccount: (account: string) => Effect.Effect<Option.Option<Account>>;
  readonly findApiKeyAccount: (keyHash: string) => Effect.Effect<Option.Option<Account>>;

  readonly getPublisher: (name: string) => Effect.Effect<Option.Option<PublisherRecord>>;
  readonly listPublishers: Effect.Effect<ReadonlyArray<PublisherRecord>>;
  /** Returns false when the name is taken. */
  readonly insertPublisher: (record: PublisherRecord) => Effect.Effect<boolean>;
  readonly updatePublisher: (
    name: string,
    patch: PublisherPatch,
  ) => Effect.Effect<Option.Option<PublisherRecord>>;

  readonly getPackage: (
    publisher: string,
    name: string,
  ) => Effect.Effect<Option.Option<PackageRecord>>;
  readonly listPackages: Effect.Effect<ReadonlyArray<PackageRecord>>;
  /** Inserts the package unless it exists, and returns the stored row. */
  readonly ensurePackage: (record: PackageRecord) => Effect.Effect<PackageRecord>;
  readonly updatePackage: (id: string, patch: PackagePatch) => Effect.Effect<void>;

  readonly listReleases: (packageId: string) => Effect.Effect<ReadonlyArray<ReleaseRecord>>;
  /** Every release, without manifests, for building the index. */
  readonly listReleaseVersions: Effect.Effect<
    ReadonlyArray<Pick<ReleaseRecord, "packageId" | "version" | "status">>
  >;
  readonly getRelease: (
    packageId: string,
    version: string,
  ) => Effect.Effect<Option.Option<ReleaseRecord>>;
  /** Returns false when the version already exists. */
  readonly insertRelease: (record: ReleaseRecord) => Effect.Effect<boolean>;
  readonly updateRelease: (id: string, patch: ReleasePatch) => Effect.Effect<void>;
}

export class Service extends Context.Service<Service, Store>()(
  "macrograph/cloudflare/RegistryStore",
) {}

const first = <A>(rows: ReadonlyArray<A>) => Option.fromNullishOr(rows[0]);

export const layerDrizzle = Layer.effect(Service)(
  Effect.gen(function* () {
    const database = yield* Database.Service;

    return {
      findAccount: (account) =>
        database
          .select({ id: users.id, email: users.email })
          .from(users)
          .where(or(eq(users.id, account), eq(users.email, account.trim().toLowerCase())))
          .limit(1)
          .pipe(Effect.map(first), Effect.orDie),
      findApiKeyAccount: (keyHash) =>
        database
          .select({ id: users.id, email: users.email })
          .from(apiKeys)
          .innerJoin(users, eq(users.id, apiKeys.userId))
          .where(eq(apiKeys.keyHash, keyHash))
          .limit(1)
          .pipe(Effect.map(first), Effect.orDie),

      getPublisher: (name) =>
        database
          .select()
          .from(registryPublishers)
          .where(eq(registryPublishers.name, name))
          .limit(1)
          .pipe(Effect.map(first), Effect.orDie),
      listPublishers: database
        .select()
        .from(registryPublishers)
        .orderBy(registryPublishers.name)
        .pipe(Effect.orDie),
      insertPublisher: (record) =>
        database
          .insert(registryPublishers)
          .values(record)
          .onConflictDoNothing()
          .returning({ name: registryPublishers.name })
          .pipe(
            Effect.map((rows) => rows.length === 1),
            Effect.orDie,
          ),
      updatePublisher: (name, patch) =>
        database
          .update(registryPublishers)
          .set(patch)
          .where(eq(registryPublishers.name, name))
          .returning()
          .pipe(Effect.map(first), Effect.orDie),

      getPackage: (publisher, name) =>
        database
          .select()
          .from(registryPackages)
          .where(and(eq(registryPackages.publisher, publisher), eq(registryPackages.name, name)))
          .limit(1)
          .pipe(Effect.map(first), Effect.orDie),
      listPackages: database
        .select()
        .from(registryPackages)
        .orderBy(registryPackages.publisher, registryPackages.name)
        .pipe(Effect.orDie),
      ensurePackage: (record) =>
        database
          .insert(registryPackages)
          .values(record)
          .onConflictDoUpdate({
            target: [registryPackages.publisher, registryPackages.name],
            // A no-op update so `returning` yields the existing row.
            set: { publisher: sql`excluded.publisher` },
          })
          .returning()
          .pipe(
            Effect.flatMap((rows) =>
              rows[0] === undefined
                ? Effect.die("Package upsert returned no row")
                : Effect.succeed(rows[0]),
            ),
            Effect.orDie,
          ),
      updatePackage: (id, patch) =>
        database
          .update(registryPackages)
          .set(patch)
          .where(eq(registryPackages.id, id))
          .pipe(Effect.asVoid, Effect.orDie),

      listReleases: (packageId) =>
        database
          .select()
          .from(registryReleases)
          .where(eq(registryReleases.packageId, packageId))
          .orderBy(registryReleases.publishedAt)
          .pipe(Effect.orDie),
      listReleaseVersions: database
        .select({
          packageId: registryReleases.packageId,
          version: registryReleases.version,
          status: registryReleases.status,
        })
        .from(registryReleases)
        .pipe(Effect.orDie),
      getRelease: (packageId, version) =>
        database
          .select()
          .from(registryReleases)
          .where(
            and(eq(registryReleases.packageId, packageId), eq(registryReleases.version, version)),
          )
          .limit(1)
          .pipe(Effect.map(first), Effect.orDie),
      insertRelease: (record) =>
        database
          .insert(registryReleases)
          .values(record)
          .onConflictDoNothing()
          .returning({ id: registryReleases.id })
          .pipe(
            Effect.map((rows) => rows.length === 1),
            Effect.orDie,
          ),
      updateRelease: (id, patch) =>
        database
          .update(registryReleases)
          .set(patch)
          .where(eq(registryReleases.id, id))
          .pipe(Effect.asVoid, Effect.orDie),
    } satisfies Store;
  }),
);

/** An in-memory store for tests and local experiments. */
export const makeMemory = (
  initial: {
    readonly accounts?: ReadonlyArray<Account & { readonly apiKeyHashes?: ReadonlyArray<string> }>;
  } = {},
) => {
  const accounts = [...(initial.accounts ?? [])];
  const publishers = new Map<string, PublisherRecord>();
  const packages = new Map<string, PackageRecord>();
  const releases = new Map<string, ReleaseRecord>();
  const toAccount = (account: Account): Account => ({ id: account.id, email: account.email });

  const store: Store = {
    findAccount: (account) =>
      Effect.sync(() =>
        Option.map(
          Option.fromNullishOr(
            accounts.find(
              (candidate) =>
                candidate.id === account || candidate.email === account.trim().toLowerCase(),
            ),
          ),
          toAccount,
        ),
      ),
    findApiKeyAccount: (keyHash) =>
      Effect.sync(() =>
        Option.map(
          Option.fromNullishOr(
            accounts.find((candidate) => candidate.apiKeyHashes?.includes(keyHash) === true),
          ),
          toAccount,
        ),
      ),
    getPublisher: (name) => Effect.sync(() => Option.fromNullishOr(publishers.get(name))),
    listPublishers: Effect.sync(() =>
      [...publishers.values()].sort((left, right) => left.name.localeCompare(right.name)),
    ),
    insertPublisher: (record) =>
      Effect.sync(() => {
        if (publishers.has(record.name)) return false;
        publishers.set(record.name, record);
        return true;
      }),
    updatePublisher: (name, patch) =>
      Effect.sync(() => {
        const existing = publishers.get(name);
        if (existing === undefined) return Option.none();
        const updated = { ...existing, ...patch };
        publishers.set(name, updated);
        return Option.some(updated);
      }),
    getPackage: (publisher, name) =>
      Effect.sync(() =>
        Option.fromNullishOr(
          [...packages.values()].find((pkg) => pkg.publisher === publisher && pkg.name === name),
        ),
      ),
    listPackages: Effect.sync(() => [...packages.values()]),
    ensurePackage: (record) =>
      Effect.sync(() => {
        const existing = [...packages.values()].find(
          (pkg) => pkg.publisher === record.publisher && pkg.name === record.name,
        );
        if (existing !== undefined) return existing;
        packages.set(record.id, record);
        return record;
      }),
    updatePackage: (id, patch) =>
      Effect.sync(() => {
        const existing = packages.get(id);
        if (existing !== undefined) packages.set(id, { ...existing, ...patch });
      }),
    listReleases: (packageId) =>
      Effect.sync(() =>
        [...releases.values()].filter((release) => release.packageId === packageId),
      ),
    listReleaseVersions: Effect.sync(() => [...releases.values()]),
    getRelease: (packageId, version) =>
      Effect.sync(() =>
        Option.fromNullishOr(
          [...releases.values()].find(
            (release) => release.packageId === packageId && release.version === version,
          ),
        ),
      ),
    insertRelease: (record) =>
      Effect.sync(() => {
        const exists = [...releases.values()].some(
          (release) => release.packageId === record.packageId && release.version === record.version,
        );
        if (exists) return false;
        releases.set(record.id, record);
        return true;
      }),
    updateRelease: (id, patch) =>
      Effect.sync(() => {
        const existing = releases.get(id);
        if (existing !== undefined) releases.set(id, { ...existing, ...patch });
      }),
  };
  return store;
};

export const layerMemory = (...args: Parameters<typeof makeMemory>) =>
  Layer.sync(Service)(() => makeMemory(...args));
