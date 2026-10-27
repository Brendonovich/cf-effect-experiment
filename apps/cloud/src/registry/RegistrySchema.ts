import type { Protocol } from "@macrograph/module-registry/Protocol";
import type { Manifest } from "@macrograph/module/Manifest";

import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { users } from "../database/DatabaseSchema.ts";

export type PublisherStatus = "pending" | "approved" | "suspended";
export type ReleaseTrustOverride = Protocol.Trust;

export const registryPublishers = pgTable(
  "registry_publishers",
  {
    name: text("name").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    status: text("status").notNull().$type<PublisherStatus>(),
    trusted: boolean("trusted").notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("registry_publishers_owner_idx").on(table.ownerUserId)],
);

export const registryPackages = pgTable(
  "registry_packages",
  {
    id: text("id").primaryKey(),
    publisher: text("publisher")
      .notNull()
      .references(() => registryPublishers.name),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("registry_packages_publisher_name_unique").on(table.publisher, table.name),
  ],
);

export const registryReleases = pgTable(
  "registry_releases",
  {
    id: text("id").primaryKey(),
    packageId: text("package_id")
      .notNull()
      .references(() => registryPackages.id),
    version: text("version").notNull(),
    api: integer("api").notNull(),
    manifest: jsonb("manifest").$type<Manifest.Model>().notNull(),
    integrity: text("integrity").notNull(),
    tarballKey: text("tarball_key").notNull(),
    trustOverride: text("trust_override").$type<ReleaseTrustOverride>(),
    status: text("status").notNull().$type<Protocol.ReleaseStatus>(),
    reason: text("reason"),
    /** The record covered by `signature`, including the effective trust it was signed with. */
    signedRecord: jsonb("signed_record").$type<Protocol.SignedRecord>().notNull(),
    signature: jsonb("signature").$type<Protocol.Signature>().notNull(),
    publishedBy: text("published_by")
      .notNull()
      .references(() => users.id),
    publishedAt: text("published_at").notNull(),
  },
  (table) => [
    uniqueIndex("registry_releases_package_version_unique").on(table.packageId, table.version),
  ],
);

export type PublisherRecord = typeof registryPublishers.$inferSelect;
export type PackageRecord = typeof registryPackages.$inferSelect;
export type ReleaseRecord = typeof registryReleases.$inferSelect;
