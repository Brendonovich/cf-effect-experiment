import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import * as InitialData from "../src/website/InitialData.ts";
import * as Jwt from "../src/website/Jwt.ts";
import {
  type App,
  type Harness,
  basic,
  body,
  deviceGrant,
  form,
  harness,
  origin,
  send,
  signIn,
  string,
  website,
} from "./OAuthHarness.ts";

const registerServer = (app: App, metadata: Record<string, unknown> = {}) =>
  Effect.gen(function* () {
    const response = yield* send(app, "/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Brendan's server",
        grant_types: [deviceGrant, "refresh_token"],
        software_id: "macrograph-server",
        ...metadata,
      }),
    });
    assert.strictEqual(response.status, 201);
    const client = yield* body(response);
    return {
      ...client,
      id: string(client.client_id),
      auth: basic(string(client.client_id), string(client.client_secret)),
    };
  });

/** Runs a device flow to completion, approved by `session`. */
const authorize = (
  app: App,
  auth: Record<string, string>,
  session: Record<string, string>,
  scope: string,
  extra: Record<string, string> = {},
) =>
  Effect.gen(function* () {
    const started = yield* body(
      yield* send(app, "/oauth/device_authorization", form({ scope, ...extra }, auth)),
    );
    const userCode = string(started.user_code);
    assert.isTrue((yield* website(app, session, "device/approve", { userCode })).ok);
    const token = yield* send(
      app,
      "/oauth/token",
      form({ grant_type: deviceGrant, device_code: string(started.device_code), ...extra }, auth),
    );
    assert.strictEqual(token.status, 200);
    return yield* body(token);
  });

const verifyJwt = (app: App, token: string) =>
  Effect.gen(function* () {
    const jwks = yield* body(yield* send(app, "/oauth/jwks"));
    const [key] = jwks.keys as ReadonlyArray<JsonWebKey & { kid: string }>;
    const [header, payload, signature] = token.split(".");
    const decode = (part: string) =>
      JSON.parse(new TextDecoder().decode(Jwt.base64UrlDecode(part))) as Record<string, unknown>;
    assert.strictEqual(decode(header!).kid, key!.kid);
    const valid = yield* Effect.promise(async () =>
      crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        await crypto.subtle.importKey(
          "jwk",
          key!,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["verify"],
        ),
        Jwt.base64UrlDecode(signature!),
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    );
    assert.isTrue(valid);
    return decode(payload!);
  });

const listAuthorizations = (app: App, session: Record<string, string>) =>
  send(app, "/api/website/authorizations", { headers: session }).pipe(
    Effect.flatMap((response) => Effect.promise((): Promise<unknown> => response.json())),
    Effect.map((value) => {
      assert.isArray(value);
      return value as ReadonlyArray<unknown>;
    }),
  );

const scoped = <A, E>(test: (harness: Harness) => Effect.Effect<A, E>) =>
  Effect.scoped(Effect.flatMap(harness, test));

// Each test starts its own in-memory Postgres with every migration applied.
describe("OAuth authorization server", { timeout: 30_000 }, () => {
  it.effect("publishes RFC 8414 metadata and a JWK set", () =>
    scoped(({ app }) =>
      Effect.gen(function* () {
        const response = yield* send(app, "/.well-known/oauth-authorization-server");
        assert.strictEqual(response.headers.get("access-control-allow-origin"), "*");
        const metadata = yield* body(response);
        assert.strictEqual(metadata.issuer, origin);
        assert.strictEqual(metadata.token_endpoint, `${origin}/oauth/token`);
        assert.strictEqual(
          metadata.device_authorization_endpoint,
          `${origin}/oauth/device_authorization`,
        );
        assert.deepStrictEqual(metadata.response_types_supported, []);
        assert.notProperty(metadata, "authorization_endpoint");
        assert.deepStrictEqual(metadata.grant_types_supported, [deviceGrant, "refresh_token"]);

        const jwks = yield* body(yield* send(app, "/oauth/jwks"));
        const [key] = jwks.keys as ReadonlyArray<Record<string, unknown>>;
        assert.strictEqual(key?.kty, "RSA");
        assert.strictEqual(key?.alg, "RS256");
        assert.notProperty(key, "d");
      }),
    ),
  );

  it.effect("registers and manages clients (RFC 7591, RFC 7592)", () =>
    scoped(({ app }) =>
      Effect.gen(function* () {
        const client = yield* registerServer(app);
        assert.match(client.id, /^mgc_/);
        assert.strictEqual(client.client_name, "Brendan's server");
        assert.strictEqual(client.token_endpoint_auth_method, "client_secret_basic");
        assert.strictEqual(client.client_secret_expires_at, 0);
        assert.deepStrictEqual(client.response_types, []);

        const rejected = (metadata: Record<string, unknown>) =>
          Effect.gen(function* () {
            const response = yield* send(app, "/oauth/register", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(metadata),
            });
            assert.strictEqual(response.status, 400);
            return (yield* body(response)).error;
          });
        assert.strictEqual(
          yield* rejected({ redirect_uris: ["https://example.com/cb"] }),
          "invalid_redirect_uri",
        );
        assert.strictEqual(
          yield* rejected({ grant_types: ["authorization_code"] }),
          "invalid_client_metadata",
        );
        assert.strictEqual(
          yield* rejected({ token_endpoint_auth_method: "none" }),
          "invalid_client_metadata",
        );

        const uri = new URL(string(client.registration_client_uri)).pathname;
        const management = { authorization: `Bearer ${string(client.registration_access_token)}` };
        const read = yield* send(app, uri, { headers: management });
        assert.strictEqual(read.status, 200);
        assert.notProperty(yield* body(read), "client_secret");
        assert.strictEqual(
          (yield* send(app, uri, { headers: { authorization: "Bearer wrong" } })).status,
          401,
        );

        const updated = yield* send(app, uri, {
          method: "PUT",
          headers: { "content-type": "application/json", ...management },
          body: JSON.stringify({ client_id: client.id, client_name: "Renamed" }),
        });
        assert.strictEqual((yield* body(updated)).client_name, "Renamed");

        assert.strictEqual(
          (yield* send(app, uri, { method: "DELETE", headers: management })).status,
          204,
        );
        const gone = yield* send(
          app,
          "/oauth/device_authorization",
          form({ scope: "openid" }, client.auth),
        );
        assert.strictEqual(gone.status, 401);
        assert.strictEqual((yield* body(gone)).error, "invalid_client");
      }),
    ),
  );

  it.effect("deletes clients that never got a grant after 30 days", () =>
    scoped(({ app, pg, advance }) =>
      Effect.gen(function* () {
        const session = yield* signIn(pg, "owner");
        const unused = yield* registerServer(app);
        const used = yield* registerServer(app);
        yield* authorize(app, used.auth, session, "openid offline_access credentials");
        advance(31 * 24 * 60 * 60 * 1000);
        yield* registerServer(app);
        const ids = yield* Effect.promise(() =>
          pg.query<{ id: string }>(`select id from auth_clients`),
        );
        const remaining = ids.rows.map((row) => row.id);
        assert.notInclude(remaining, unused.id);
        assert.include(remaining, used.id);
      }),
    ),
  );

  it.effect("runs the device flow (RFC 8628) and issues OpenID ID tokens", () =>
    scoped(({ app, pg, advance }) =>
      Effect.gen(function* () {
        const client = yield* registerServer(app);
        const session = yield* signIn(pg, "owner");

        const response = yield* send(
          app,
          "/oauth/device_authorization",
          form({ scope: "openid email offline_access credentials" }, client.auth),
        );
        assert.strictEqual(response.headers.get("cache-control"), "no-store");
        const started = yield* body(response);
        assert.match(
          string(started.user_code),
          /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/,
        );
        assert.strictEqual(started.verification_uri, `${origin}/device`);
        assert.strictEqual(
          started.verification_uri_complete,
          `${origin}/device?user_code=${started.user_code}`,
        );
        assert.strictEqual(started.expires_in, 600);
        assert.strictEqual(started.interval, 5);

        const poll = () =>
          send(
            app,
            "/oauth/token",
            form(
              { grant_type: deviceGrant, device_code: string(started.device_code) },
              client.auth,
            ),
          ).pipe(Effect.flatMap(body));
        assert.strictEqual((yield* poll()).error, "authorization_pending");
        assert.strictEqual((yield* poll()).error, "slow_down");
        advance(11_000);
        assert.strictEqual((yield* poll()).error, "authorization_pending");

        // The verification page accepts the code in any case and without punctuation.
        const typed = string(started.user_code).replace("-", "").toLowerCase();
        const lookup = yield* body(
          yield* website(app, session, "device/lookup", { userCode: typed }),
        );
        assert.deepStrictEqual(lookup.client, {
          id: client.id,
          name: "Brendan's server",
          verified: false,
        });
        assert.deepStrictEqual(lookup.scope, ["openid", "email", "offline_access", "credentials"]);
        assert.strictEqual(
          (yield* website(app, session, "device/approve", { userCode: typed })).status,
          200,
        );

        advance(11_000);
        const tokens = yield* poll();
        assert.strictEqual(tokens.token_type, "Bearer");
        assert.strictEqual(tokens.expires_in, 3600);
        assert.strictEqual(tokens.scope, "openid email offline_access credentials");
        assert.match(string(tokens.access_token), /^mgat_/);
        assert.match(string(tokens.refresh_token), /^mgrt_/);
        const claims = yield* verifyJwt(app, string(tokens.id_token));
        assert.strictEqual(claims.iss, origin);
        assert.strictEqual(claims.sub, "owner");
        assert.strictEqual(claims.aud, client.id);
        assert.strictEqual(claims.email, "owner@example.com");
        assert.strictEqual(claims.email_verified, false);
        assert.isAbove(Number(claims.exp), Number(claims.iat));

        // Device codes are single-use.
        advance(11_000);
        assert.strictEqual((yield* poll()).error, "invalid_grant");

        const userInfo = yield* body(
          yield* send(app, "/oauth/userinfo", {
            headers: { authorization: `Bearer ${string(tokens.access_token)}` },
          }),
        );
        assert.deepStrictEqual(userInfo, {
          sub: "owner",
          email: "owner@example.com",
          email_verified: false,
        });
      }),
    ),
  );

  it.effect("reports denied and expired device codes", () =>
    scoped(({ app, pg, advance }) =>
      Effect.gen(function* () {
        const client = yield* registerServer(app);
        const session = yield* signIn(pg, "user");
        const start = send(
          app,
          "/oauth/device_authorization",
          form({ scope: "openid" }, client.auth),
        ).pipe(Effect.flatMap(body));
        const poll = (deviceCode: unknown) =>
          send(
            app,
            "/oauth/token",
            form({ grant_type: deviceGrant, device_code: string(deviceCode) }, client.auth),
          ).pipe(Effect.flatMap(body));

        const denied = yield* start;
        yield* website(app, session, "device/deny", { userCode: denied.user_code });
        assert.strictEqual((yield* poll(denied.device_code)).error, "access_denied");

        const expired = yield* start;
        advance(601_000);
        assert.strictEqual((yield* poll(expired.device_code)).error, "expired_token");
        assert.strictEqual(
          (yield* website(app, session, "device/lookup", { userCode: expired.user_code })).status,
          404,
        );
      }),
    ),
  );

  it.effect("authenticates clients per RFC 6749 §2.3 and validates requests", () =>
    scoped(({ app }) =>
      Effect.gen(function* () {
        const client = yield* registerServer(app);
        const wrong = yield* send(
          app,
          "/oauth/device_authorization",
          form({ scope: "openid" }, basic(client.id, "wrong")),
        );
        assert.strictEqual(wrong.status, 401);
        assert.strictEqual(wrong.headers.get("www-authenticate"), 'Basic realm="macrograph"');
        assert.strictEqual((yield* body(wrong)).error, "invalid_client");

        const missingSecret = yield* send(
          app,
          "/oauth/device_authorization",
          form({ client_id: client.id, scope: "openid" }),
        );
        assert.strictEqual((yield* body(missingSecret)).error, "invalid_client");

        const wrongMethod = yield* send(
          app,
          "/oauth/device_authorization",
          form({
            client_id: client.id,
            client_secret: string(client.client_secret),
            scope: "openid",
          }),
        );
        assert.strictEqual((yield* body(wrongMethod)).error, "invalid_client");

        const publicWithSecret = yield* send(
          app,
          "/oauth/device_authorization",
          form({ scope: "openid" }, basic("macrograph-playground", "secret")),
        );
        assert.strictEqual((yield* body(publicWithSecret)).error, "invalid_client");

        const error = (path: string, init: RequestInit) =>
          send(app, path, init).pipe(
            Effect.flatMap(body),
            Effect.map((value) => value.error),
          );
        assert.strictEqual(
          yield* error("/oauth/device_authorization", form({ scope: "everything" }, client.auth)),
          "invalid_scope",
        );
        assert.strictEqual(
          yield* error("/oauth/token", form({ grant_type: "password" }, client.auth)),
          "unsupported_grant_type",
        );
        assert.strictEqual(
          yield* error("/oauth/token", {
            method: "POST",
            headers: { "content-type": "application/json", ...client.auth },
            body: JSON.stringify({ grant_type: deviceGrant }),
          }),
          "invalid_request",
        );
        assert.strictEqual(
          yield* error("/oauth/token", {
            ...form({}, client.auth),
            body: `grant_type=${encodeURIComponent(deviceGrant)}&device_code=a&device_code=b`,
          }),
          "invalid_request",
        );
      }),
    ),
  );

  it.effect("rotates refresh tokens and revokes the grant on reuse (RFC 9700)", () =>
    scoped(({ app, pg }) =>
      Effect.gen(function* () {
        const client = yield* registerServer(app);
        const session = yield* signIn(pg, "owner");
        const tokens = yield* authorize(
          app,
          client.auth,
          session,
          "openid email offline_access credentials",
        );
        const refresh = (refreshToken: unknown, scope?: string) =>
          send(
            app,
            "/oauth/token",
            form(
              {
                grant_type: "refresh_token",
                refresh_token: string(refreshToken),
                ...(scope === undefined ? {} : { scope }),
              },
              client.auth,
            ),
          ).pipe(Effect.flatMap(body));

        const narrowed = yield* refresh(tokens.refresh_token, "credentials");
        assert.strictEqual(narrowed.scope, "credentials");
        assert.notProperty(narrowed, "id_token");
        assert.notStrictEqual(narrowed.refresh_token, tokens.refresh_token);

        assert.strictEqual(
          (yield* refresh(narrowed.refresh_token, "openid email offline_access credentials admin"))
            .error,
          "invalid_scope",
        );

        const rotated = yield* refresh(narrowed.refresh_token);
        assert.strictEqual(rotated.scope, "openid email offline_access credentials");
        const claims = yield* verifyJwt(app, string(rotated.id_token));
        assert.strictEqual(claims.sub, "owner");

        // Replaying a retired refresh token ends the grant, including the newest tokens.
        assert.strictEqual((yield* refresh(tokens.refresh_token)).error, "invalid_grant");
        assert.strictEqual((yield* refresh(rotated.refresh_token)).error, "invalid_grant");
        const revoked = yield* send(app, "/api/credentials", {
          headers: { authorization: `Bearer ${string(rotated.access_token)}` },
        });
        assert.strictEqual(revoked.status, 401);
        assert.include(revoked.headers.get("www-authenticate") ?? "", 'error="invalid_token"');
      }),
    ),
  );

  it.effect("protects credentials with bearer tokens (RFC 6750)", () =>
    scoped(({ app, pg }) =>
      Effect.gen(function* () {
        const client = yield* registerServer(app);
        const session = yield* signIn(pg, "owner");
        yield* Effect.promise(() =>
          pg.query(
            `insert into "oauth_credential" (provider_id, user_id, provider_user_id, token, token_created_at, display_name) values ('twitch', 'owner', '42', $1, now(), 'brendan')`,
            [
              JSON.stringify({
                access_token: "twitch-access",
                refresh_token: "twitch-refresh",
                expires_in: 3600,
                token_type: "bearer",
              }),
            ],
          ),
        );

        const signInOnly = yield* authorize(app, client.auth, session, "openid email");
        assert.notProperty(signInOnly, "refresh_token");
        const forbidden = yield* send(app, "/api/credentials", {
          headers: { authorization: `Bearer ${string(signInOnly.access_token)}` },
        });
        assert.strictEqual(forbidden.status, 403);
        assert.include(
          forbidden.headers.get("www-authenticate") ?? "",
          'error="insufficient_scope"',
        );

        const owner = yield* authorize(
          app,
          client.auth,
          session,
          "openid offline_access credentials",
        );
        const credentials = yield* send(app, "/api/credentials", {
          headers: { authorization: `Bearer ${string(owner.access_token)}` },
        });
        assert.strictEqual(credentials.status, 200);
        assert.strictEqual(credentials.headers.get("access-control-allow-origin"), "*");
        const [credential] = (yield* Effect.promise(() => credentials.json())) as ReadonlyArray<{
          readonly token: Record<string, unknown>;
        }>;
        assert.strictEqual(credential?.token.access_token, "twitch-access");
        assert.notProperty(credential?.token, "refresh_token");

        const missing = yield* send(app, "/oauth/userinfo");
        assert.strictEqual(missing.status, 401);
        assert.strictEqual(missing.headers.get("www-authenticate"), 'Bearer realm="macrograph"');
      }),
    ),
  );

  it.effect("revokes tokens (RFC 7009) and lists authorized apps", () =>
    scoped(({ app, pg }) =>
      Effect.gen(function* () {
        const client = yield* registerServer(app);
        const other = yield* registerServer(app, { client_name: "Someone else" });
        const session = yield* signIn(pg, "owner");
        const tokens = yield* authorize(
          app,
          client.auth,
          session,
          "openid offline_access credentials",
        );
        const revoke = (token: unknown, auth: Record<string, string>) =>
          send(app, "/oauth/revoke", form({ token: string(token) }, auth));

        assert.strictEqual((yield* revoke("unknown", client.auth)).status, 200);
        assert.strictEqual((yield* revoke(tokens.access_token, other.auth)).status, 400);
        assert.strictEqual((yield* revoke(tokens.access_token, client.auth)).status, 200);
        const userInfo = yield* send(app, "/oauth/userinfo", {
          headers: { authorization: `Bearer ${string(tokens.access_token)}` },
        });
        assert.strictEqual(userInfo.status, 401);

        const authorizations = (yield* listAuthorizations(app, session)) as ReadonlyArray<{
          readonly client: { readonly name: string };
        }>;
        assert.deepStrictEqual(
          authorizations.map((grant) => grant.client.name),
          ["Brendan's server"],
        );

        assert.strictEqual((yield* revoke(tokens.refresh_token, client.auth)).status, 200);
        assert.deepStrictEqual(yield* listAuthorizations(app, session), []);

        const again = yield* authorize(
          app,
          client.auth,
          session,
          "openid offline_access credentials",
        );
        const [grant] = (yield* listAuthorizations(app, session)) as ReadonlyArray<{
          readonly id: string;
        }>;
        const removed = yield* send(app, `/api/website/authorizations/${grant!.id}`, {
          method: "DELETE",
          headers: session,
        });
        assert.strictEqual(removed.status, 204);
        const refreshed = yield* send(
          app,
          "/oauth/token",
          form(
            { grant_type: "refresh_token", refresh_token: string(again.refresh_token) },
            client.auth,
          ),
        );
        assert.strictEqual((yield* body(refreshed)).error, "invalid_grant");
      }),
    ),
  );

  it.effect("lets built-in public clients authenticate with client_id alone", () =>
    scoped(({ app, pg }) =>
      Effect.gen(function* () {
        const session = yield* signIn(pg, "user");
        const auth = {};
        const extra = { client_id: "macrograph-playground" };
        const started = yield* body(
          yield* send(
            app,
            "/oauth/device_authorization",
            form({ scope: "openid", ...extra }, auth),
          ),
        );
        const lookup = yield* body(
          yield* website(app, session, "device/lookup", { userCode: started.user_code }),
        );
        assert.deepStrictEqual(lookup.client, {
          id: "macrograph-playground",
          name: "MacroGraph Playground",
          verified: true,
        });
        const tokens = yield* authorize(
          app,
          auth,
          session,
          "openid email offline_access credentials",
          extra,
        );
        assert.strictEqual(
          (yield* verifyJwt(app, string(tokens.id_token))).aud,
          "macrograph-playground",
        );
      }),
    ),
  );

  it.effect("provides the device page's first-render data", () =>
    scoped(({ app, pg }) =>
      Effect.gen(function* () {
        const client = yield* registerServer(app);
        const session = yield* signIn(pg, "owner");
        const started = yield* body(
          yield* send(app, "/oauth/device_authorization", form({ scope: "openid" }, client.auth)),
        );
        const page = (query: string, headers: Record<string, string> = {}) =>
          send(app, `/api/website/device${query}`, { headers }).pipe(Effect.flatMap(body));

        assert.deepStrictEqual(yield* page(`?user_code=${started.user_code}`), { session: null });
        const data = yield* page(`?user_code=${started.user_code}`, { cookie: session.cookie });
        assert.strictEqual((data.session as { user: { id: string } }).user.id, "owner");
        const device = data.device as { userCode: string; request: { client: { name: string } } };
        assert.strictEqual(device.userCode, started.user_code);
        assert.strictEqual(device.request.client.name, "Brendan's server");
        const unknown = yield* page("?user_code=BBBB-BBBB", { cookie: session.cookie });
        assert.deepStrictEqual(unknown.device, { userCode: "BBBB-BBBB", request: null });
      }),
    ),
  );

  it("embeds first-render data without letting it close the script element", () => {
    const html = InitialData.inject("<html><head><title>x</title></head><body></body></html>", {
      name: "</script><script>alert(1)</script>",
    });
    assert.include(html, '<script id="macrograph-initial-data" type="application/json">');
    assert.notInclude(html, "</script><script>alert(1)");
    assert.isTrue(html.indexOf("macrograph-initial-data") < html.indexOf("</head>"));
    const json = html.slice(html.indexOf('json">') + 6, html.indexOf("</script></head>"));
    assert.deepStrictEqual(JSON.parse(json), { name: "</script><script>alert(1)</script>" });
  });

  it.effect("requires a same-origin website session to approve codes", () =>
    scoped(({ app, pg }) =>
      Effect.gen(function* () {
        const client = yield* registerServer(app);
        const session = yield* signIn(pg, "user");
        const started = yield* body(
          yield* send(app, "/oauth/device_authorization", form({ scope: "openid" }, client.auth)),
        );
        const crossSite = yield* website(
          app,
          { cookie: session.cookie, origin: "https://attacker.example" },
          "device/approve",
          { userCode: started.user_code },
        );
        assert.strictEqual(crossSite.status, 403);
        const anonymous = yield* website(app, { origin }, "device/approve", {
          userCode: started.user_code,
        });
        assert.strictEqual(anonymous.status, 401);
      }),
    ),
  );
});
