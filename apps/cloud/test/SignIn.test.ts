import { afterEach, assert, describe, it, vi } from "@effect/vitest";
import { Effect } from "effect";

import * as Password from "../src/website/Password.ts";
import { type App, body, harness, harnessWith, send, string } from "./OAuthHarness.ts";

interface TwitchUser {
  readonly sub: string;
  readonly preferred_username: string;
  readonly email?: string;
  readonly email_verified?: boolean;
}

/** Answers Twitch's token and userinfo endpoints as `user`, recording token requests. */
const tokenRequests: Array<URLSearchParams> = [];
const twitchAs = (user: TwitchUser) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://id.twitch.tv/oauth2/token") {
        tokenRequests.push(new URLSearchParams(String(init?.body)));
        return Response.json({ access_token: "access", token_type: "bearer", expires_in: 3600 });
      }
      if (url === "https://id.twitch.tv/oauth2/userinfo") return Response.json(user);
      return new Response(null, { status: 404 });
    }),
  );

const cookieValue = (response: Response, name: string) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0] ?? "")
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1);

const location = (response: Response) => {
  assert.strictEqual(response.status, 302);
  return new URL(response.headers.get("location") ?? "", "https://macrograph.app");
};

/** Signs in with Twitch from `returnTo`, optionally as an existing session. */
const signInWithTwitch = (
  app: App,
  options: { readonly session?: string; readonly returnTo?: string; readonly nonce?: string } = {},
) =>
  Effect.gen(function* () {
    const sessionCookie = options.session === undefined ? {} : { cookie: options.session };
    const start = yield* send(
      app,
      `/api/website/sign-in/twitch?returnTo=${encodeURIComponent(options.returnTo ?? "/login?next=%2Fcloud")}`,
      { headers: sessionCookie },
    );
    const authorize = location(start);
    const nonce = options.nonce ?? string(cookieValue(start, "sign_in_nonce"));
    const cookies = [`sign_in_nonce=${nonce}`, ...(options.session ? [options.session] : [])];
    const callback = yield* send(
      app,
      `/api/auth/twitch/callback?code=code&state=${authorize.searchParams.get("state")}`,
      { headers: { cookie: cookies.join("; ") } },
    );
    return { authorize, callback };
  });

const sessionOf = (app: App, response: Response) =>
  Effect.gen(function* () {
    const id = string(cookieValue(response, "auth_session"));
    const session = yield* body(
      yield* send(app, "/api/website/session", { headers: { cookie: `auth_session=${id}` } }),
    );
    return { cookie: `auth_session=${id}`, user: session.user as Record<string, unknown> };
  });

const streamer = {
  sub: "1001",
  preferred_username: "streamer",
  email: "Streamer@Example.com",
  email_verified: true,
} satisfies TwitchUser;

describe("signing in with a provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    tokenRequests.length = 0;
  });

  it.effect("returns through a provider's own redirect origin", () =>
    Effect.gen(function* () {
      const { app } = yield* harnessWith({
        authRedirectOrigin: "https://macrograph.brendonovich.dev",
        providerRedirectOrigins: { twitch: "https://macrograph.app" },
      });
      twitchAs(streamer);
      const { authorize, callback } = yield* signInWithTwitch(app);
      assert.strictEqual(
        authorize.searchParams.get("redirect_uri"),
        "https://macrograph.app/auth/proxy",
      );
      assert.isNull(location(callback).searchParams.get("error"));
      // The code exchange repeats the redirect URI the code was issued for.
      assert.strictEqual(
        tokenRequests[0]?.get("redirect_uri"),
        "https://macrograph.app/auth/proxy",
      );
    }),
  );

  it.effect("creates an account from a verified provider account", () =>
    Effect.gen(function* () {
      const { app, pg } = yield* harness;
      twitchAs(streamer);
      const { authorize, callback } = yield* signInWithTwitch(app);

      // Signing in asks for none of the scopes graphs use.
      assert.strictEqual(authorize.origin, "https://id.twitch.tv");
      assert.strictEqual(authorize.searchParams.get("scope"), "openid user:read:email");
      assert.strictEqual(
        authorize.searchParams.get("redirect_uri"),
        "https://macrograph.app/auth/proxy",
      );

      assert.strictEqual(location(callback).pathname, "/login");
      assert.strictEqual(location(callback).searchParams.get("next"), "/cloud");
      assert.strictEqual(cookieValue(callback, "sign_in_nonce"), "");
      const { user } = yield* sessionOf(app, callback);
      assert.strictEqual(user.email, "streamer@example.com");
      assert.isTrue(user.hasSignInMethod);

      // Signing in again finds the same account.
      const again = yield* signInWithTwitch(app);
      assert.strictEqual((yield* sessionOf(app, again.callback)).user.id, user.id);
      const users = yield* Effect.promise(() => pg.query(`select id from "user"`));
      assert.strictEqual(users.rows.length, 1);
    }),
  );

  it.effect("rejects provider accounts without a verified email", () =>
    Effect.gen(function* () {
      const { app, pg } = yield* harness;
      twitchAs({ ...streamer, email_verified: false });
      const { callback } = yield* signInWithTwitch(app);
      assert.strictEqual(location(callback).searchParams.get("error"), "email_unverified");
      assert.isUndefined(cookieValue(callback, "auth_session"));
      const users = yield* Effect.promise(() => pg.query(`select id from "user"`));
      assert.strictEqual(users.rows.length, 0);
    }),
  );

  it.effect("only completes in the browser that started it", () =>
    Effect.gen(function* () {
      const { app } = yield* harness;
      twitchAs(streamer);
      const { callback } = yield* signInWithTwitch(app, { nonce: "someone-else" });
      assert.strictEqual(location(callback).searchParams.get("error"), "expired");
      assert.isUndefined(cookieValue(callback, "auth_session"));
    }),
  );

  it.effect("makes password accounts connect a provider before anything else", () =>
    Effect.gen(function* () {
      const { app, pg } = yield* harness;
      const hashedPassword = yield* Password.hash("hunter2hunter2");
      yield* Effect.promise(() =>
        pg.query(`insert into "user" (id, email, hashed_password) values ('legacy', $1, $2)`, [
          "streamer@example.com",
          hashedPassword,
        ]),
      );

      // A matching email is never enough to sign in to an existing account.
      twitchAs(streamer);
      const unlinked = yield* signInWithTwitch(app);
      assert.strictEqual(location(unlinked.callback).searchParams.get("error"), "account_exists");

      const login = yield* send(app, "/api/website/login", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://macrograph.app" },
        body: JSON.stringify({ email: "streamer@example.com", password: "hunter2hunter2" }),
      });
      const { cookie, user } = yield* sessionOf(app, login);
      assert.isFalse(user.hasSignInMethod);
      const headers = { cookie };
      assert.strictEqual((yield* send(app, "/api/website/credentials", { headers })).status, 403);
      assert.strictEqual((yield* send(app, "/api/credentials", { headers })).status, 403);
      assert.strictEqual(
        (yield* send(app, "/api/website/authorizations", { headers })).status,
        403,
      );
      const methods = yield* send(app, "/api/website/sign-in-methods", { headers });
      assert.deepStrictEqual(yield* Effect.promise(() => methods.json()), []);

      const linked = yield* signInWithTwitch(app, {
        session: cookie,
        returnTo: "/account/sign-in",
      });
      assert.strictEqual(location(linked.callback).pathname, "/account/sign-in");
      assert.isNull(location(linked.callback).searchParams.get("error"));
      assert.isTrue((yield* sessionOf(app, login)).user.hasSignInMethod);
      assert.strictEqual((yield* send(app, "/api/website/credentials", { headers })).status, 200);

      // The provider now signs in to the original account.
      const signedIn = yield* signInWithTwitch(app);
      assert.strictEqual((yield* sessionOf(app, signedIn.callback)).user.id, "legacy");
    }),
  );

  it.effect("won't connect a provider account another user signs in with", () =>
    Effect.gen(function* () {
      const { app } = yield* harness;
      twitchAs(streamer);
      yield* signInWithTwitch(app);
      twitchAs({ ...streamer, sub: "2002", email: "other@example.com" });
      const other = yield* sessionOf(app, (yield* signInWithTwitch(app)).callback);

      twitchAs(streamer);
      const { callback } = yield* signInWithTwitch(app, {
        session: other.cookie,
        returnTo: "/account/sign-in",
      });
      assert.strictEqual(location(callback).searchParams.get("error"), "identity_in_use");
    }),
  );

  it.effect("keeps at least one sign-in method", () =>
    Effect.gen(function* () {
      const { app } = yield* harness;
      twitchAs(streamer);
      const { cookie } = yield* sessionOf(app, (yield* signInWithTwitch(app)).callback);
      const remove = (providerUserId: string) =>
        send(app, `/api/website/sign-in-methods/twitch/${providerUserId}`, {
          method: "DELETE",
          headers: { cookie, origin: "https://macrograph.app" },
        });
      assert.strictEqual((yield* remove("1001")).status, 409);

      twitchAs({ ...streamer, sub: "1002", email: "alt@example.com" });
      yield* signInWithTwitch(app, { session: cookie, returnTo: "/account/sign-in" });
      assert.strictEqual((yield* remove("1001")).status, 204);
      const methods = yield* send(app, "/api/website/sign-in-methods", { headers: { cookie } });
      assert.deepStrictEqual(yield* Effect.promise(() => methods.json()), [
        {
          providerId: "twitch",
          providerUserId: "1002",
          displayName: "streamer",
          email: "alt@example.com",
        },
      ]);
    }),
  );
});
