import {
  index,
  integer,
  json,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export interface OAuthToken {
  readonly access_token: string;
  readonly expires_in: number;
  readonly refresh_token?: string;
  readonly token_type: string;
  readonly scope?: string;
}

export const accountUsers = pgTable("user", {
  id: varchar("id", { length: 255 }).primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  hashedPassword: varchar("hashed_password", { length: 255 }).notNull(),
});

export const accountSessions = pgTable("session", {
  id: varchar("id", { length: 255 }).primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const oauthCredentials = pgTable(
  "oauth_credential",
  {
    providerId: varchar("provider_id", { length: 255 }).notNull(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    providerUserId: varchar("provider_user_id", { length: 255 }).notNull(),
    token: json("token").$type<OAuthToken>().notNull(),
    issuedAt: timestamp("token_created_at").notNull(),
    displayName: varchar("display_name", { length: 255 }),
  },
  (table) => [primaryKey({ columns: [table.providerId, table.userId, table.providerUserId] })],
);

// ---- OAuth authorization server (see OAUTH.md) ----

/** Clients registered through RFC 7591. Built-in public clients are defined in code. */
export const authClients = pgTable("auth_clients", {
  id: varchar("id", { length: 64 }).primaryKey(),
  secretHash: varchar("secret_hash", { length: 64 }).notNull(),
  registrationTokenHash: varchar("registration_token_hash", { length: 64 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  softwareId: varchar("software_id", { length: 255 }),
  softwareVersion: varchar("software_version", { length: 255 }),
  tokenEndpointAuthMethod: varchar("token_endpoint_auth_method", {
    length: 32,
    enum: ["client_secret_basic", "client_secret_post"],
  }).notNull(),
  scope: text("scope").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at").notNull().defaultNow(),
  createdIp: varchar("created_ip", { length: 64 }),
});

export const authDeviceAuthorizations = pgTable(
  "auth_device_authorizations",
  {
    deviceCodeHash: varchar("device_code_hash", { length: 64 }).primaryKey(),
    userCode: varchar("user_code", { length: 8 }).notNull().unique(),
    /** A registered client's ID or a built-in public client's. */
    clientId: varchar("client_id", { length: 64 }).notNull(),
    scope: text("scope").notNull(),
    status: varchar("status", { length: 16, enum: ["pending", "approved", "denied"] }).notNull(),
    userId: varchar("user_id", { length: 255 }).references(() => accountUsers.id, {
      onDelete: "cascade",
    }),
    intervalSeconds: integer("interval_seconds").notNull(),
    lastPolledAt: timestamp("last_polled_at"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    requestIp: varchar("request_ip", { length: 64 }),
    requestCountry: varchar("request_country", { length: 8 }),
  },
  (table) => [index("auth_device_authorizations_client_idx").on(table.clientId)],
);

export const authGrants = pgTable(
  "auth_grants",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    clientId: varchar("client_id", { length: 64 }).notNull(),
    userId: varchar("user_id", { length: 255 })
      .notNull()
      .references(() => accountUsers.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at").notNull().defaultNow(),
    /** When the grant ends; refreshing an `offline_access` grant extends it. */
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => [
    index("auth_grants_user_idx").on(table.userId),
    index("auth_grants_client_idx").on(table.clientId),
  ],
);

export const authRefreshTokens = pgTable(
  "auth_refresh_tokens",
  {
    tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
    grantId: varchar("grant_id", { length: 64 })
      .notNull()
      .references(() => authGrants.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    /** Set when the token is exchanged; presenting it again revokes the grant. */
    rotatedAt: timestamp("rotated_at"),
  },
  (table) => [index("auth_refresh_tokens_grant_idx").on(table.grantId)],
);

export const authAccessTokens = pgTable(
  "auth_access_tokens",
  {
    tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
    grantId: varchar("grant_id", { length: 64 })
      .notNull()
      .references(() => authGrants.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => [index("auth_access_tokens_grant_idx").on(table.grantId)],
);

export const authRateLimits = pgTable("auth_rate_limits", {
  key: varchar("key", { length: 255 }).primaryKey(),
  windowStart: timestamp("window_start").notNull(),
  count: integer("count").notNull(),
});
