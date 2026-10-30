import { and, eq } from "drizzle-orm";
import { type Context, Effect } from "effect";

import type * as Database from "../database/Database.ts";
import type * as OAuthProviders from "./OAuthProviders.ts";

import { oauthCredentials, type OAuthToken } from "../database/AccountDatabaseSchema.ts";

/** A credential as handed to a project editor's engines. */
export interface CredentialTransfer {
  readonly id: string;
  readonly provider: string;
  readonly displayName?: string | null;
  readonly clientId?: string;
  readonly token: { readonly access: string };
}

type Row = typeof oauthCredentials.$inferSelect;
type Database = Context.Service.Shape<typeof Database.Service>;
type Providers = Pick<Context.Service.Shape<typeof OAuthProviders.Service>, "get" | "refresh">;

export const toTransfer = (row: Row, providers: Pick<Providers, "get">): CredentialTransfer => {
  const provider = providers.get(row.providerId);
  return {
    id: row.providerUserId,
    provider: row.providerId,
    ...(row.displayName === null ? {} : { displayName: row.displayName }),
    ...(provider === undefined ? {} : { clientId: provider.clientId }),
    token: { access: row.token.access_token },
  };
};

export const rowsFor = (database: Database, userId: string) =>
  database
    .select()
    .from(oauthCredentials)
    .where(eq(oauthCredentials.userId, userId))
    .pipe(Effect.orDie);

/**
 * Refreshes a stored credential with its provider and saves the new token. Returns the current
 * row unchanged when the provider cannot refresh, and `undefined` when the credential is gone.
 */
export const refresh = (
  database: Database,
  providers: Providers,
  userId: string,
  providerId: string,
  credentialId: string,
) =>
  Effect.gen(function* (): Effect.fn.Return<Row | undefined> {
    const where = and(
      eq(oauthCredentials.userId, userId),
      eq(oauthCredentials.providerId, providerId),
      eq(oauthCredentials.providerUserId, credentialId),
    );
    const matches = yield* database
      .select()
      .from(oauthCredentials)
      .where(where)
      .limit(1)
      .pipe(Effect.orDie);
    const row = matches[0];
    if (row === undefined) return undefined;
    const provider = providers.get(providerId);
    const refreshToken = row.token.refresh_token;
    if (provider === undefined || refreshToken === undefined) return row;
    const request: Effect.Effect<OAuthToken | undefined, OAuthProviders.ProviderError> =
      providers.refresh(provider, refreshToken);
    // A failed refresh leaves the stored token for the caller to try.
    const refreshed = yield* request.pipe(
      Effect.catchTag("OAuthProviderError", () => Effect.succeed(undefined)),
    );
    if (refreshed === undefined) return row;
    const issuedAt = new Date();
    yield* database
      .update(oauthCredentials)
      .set({ token: refreshed, issuedAt })
      .where(where)
      .pipe(Effect.orDie);
    return { ...row, token: refreshed, issuedAt };
  });
