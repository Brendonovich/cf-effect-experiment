import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { type Cookies, HttpServerResponse } from "effect/http";

import {
  accountSessions,
  accountUsers,
  userIdentities,
} from "../database/AccountDatabaseSchema.ts";
import * as Database from "../database/Database.ts";

// Compatible with the Lucia v3 sessions issued by the original website.
export const cookieName = "auth_session";
export const loggedInCookieName = "isLoggedIn";
const lifetimeMs = 30 * 24 * 60 * 60 * 1000;

const randomString = (length: number, alphabet: string) => {
  // Rejection sampling keeps the distribution uniform.
  const limit = 256 - (256 % alphabet.length);
  let result = "";
  while (result.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && result.length < length) result += alphabet[byte % alphabet.length];
    }
  }
  return result;
};

/** Generates an ID in the format of Lucia's `generateId`. */
export const generateId = (length: number) =>
  randomString(length, "abcdefghijklmnopqrstuvwxyz0123456789");

const generateSessionId = () => {
  // Lucia's `generateIdFromEntropySize(25)`: 25 random bytes as lowercase base32.
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let result = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of crypto.getRandomValues(new Uint8Array(25))) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return result;
};

export interface Validated {
  readonly session: { readonly id: string; readonly expiresAt: Date; readonly fresh: boolean };
  readonly user: {
    readonly id: string;
    readonly email: string;
    /**
     * Accounts from before sign-in providers only have a password. They may sign in, but must
     * connect a provider before using anything else.
     */
    readonly hasSignInMethod: boolean;
  };
}

const cookieOptions = (secure: boolean, httpOnly: boolean, maxAge?: number) =>
  ({
    path: "/",
    sameSite: "lax",
    secure,
    httpOnly,
    ...(maxAge === undefined ? {} : { maxAge: `${maxAge} seconds` as const }),
  }) satisfies Cookies.Cookie["options"];

/** Sets Lucia's session cookie plus the client-readable `isLoggedIn` hint. */
export const setCookies =
  (sessionId: string, secure: boolean) => (response: HttpServerResponse.HttpServerResponse) =>
    response.pipe(
      HttpServerResponse.setCookieUnsafe(
        cookieName,
        sessionId,
        cookieOptions(secure, true, lifetimeMs / 1000),
      ),
      HttpServerResponse.setCookieUnsafe(loggedInCookieName, "true", cookieOptions(secure, false)),
    );

export const refreshCookie =
  (sessionId: string, secure: boolean) => (response: HttpServerResponse.HttpServerResponse) =>
    HttpServerResponse.setCookieUnsafe(
      response,
      cookieName,
      sessionId,
      cookieOptions(secure, true, lifetimeMs / 1000),
    );

export const clearSessionCookie =
  (secure: boolean) => (response: HttpServerResponse.HttpServerResponse) =>
    HttpServerResponse.setCookieUnsafe(response, cookieName, "", cookieOptions(secure, true, 0));

export const clearCookies =
  (secure: boolean) => (response: HttpServerResponse.HttpServerResponse) =>
    response.pipe(
      clearSessionCookie(secure),
      HttpServerResponse.setCookieUnsafe(loggedInCookieName, "", cookieOptions(secure, false, 0)),
    );

export const make = Effect.gen(function* () {
  const database = yield* Database.Service;

  const create = (userId: string) =>
    Effect.gen(function* () {
      const id = generateSessionId();
      yield* database
        .insert(accountSessions)
        .values({ id, userId, expiresAt: new Date(Date.now() + lifetimeMs) })
        .pipe(Effect.orDie);
      return id;
    });

  const invalidate = (sessionId: string) =>
    database
      .delete(accountSessions)
      .where(eq(accountSessions.id, sessionId))
      .pipe(Effect.orDie, Effect.asVoid);

  const validate = (sessionId: string) =>
    Effect.gen(function* (): Effect.fn.Return<Validated | undefined> {
      const rows = yield* database
        .select({
          id: accountSessions.id,
          expiresAt: accountSessions.expiresAt,
          userId: accountUsers.id,
          email: accountUsers.email,
          hasSignInMethod: sql<boolean>`exists (select 1 from ${userIdentities} where ${userIdentities.userId} = ${accountUsers.id})`,
        })
        .from(accountSessions)
        .innerJoin(accountUsers, eq(accountUsers.id, accountSessions.userId))
        .where(eq(accountSessions.id, sessionId))
        .limit(1)
        .pipe(Effect.orDie);
      const row = rows[0];
      if (row === undefined) return undefined;
      const now = Date.now();
      if (row.expiresAt.getTime() <= now) {
        yield* invalidate(row.id);
        return undefined;
      }
      let expiresAt = row.expiresAt;
      // Like Lucia, extend sessions once they are in the second half of their lifetime.
      const fresh = expiresAt.getTime() - lifetimeMs / 2 <= now;
      if (fresh) {
        expiresAt = new Date(now + lifetimeMs);
        yield* database
          .update(accountSessions)
          .set({ expiresAt })
          .where(eq(accountSessions.id, row.id))
          .pipe(Effect.orDie);
      }
      return {
        session: { id: row.id, expiresAt, fresh },
        user: { id: row.userId, email: row.email, hasSignInMethod: row.hasSignInMethod },
      };
    });

  return { create, invalidate, validate };
});
