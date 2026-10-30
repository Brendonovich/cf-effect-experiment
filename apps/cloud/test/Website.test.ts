import type * as SqlConnection from "effect/sql/SqlConnection";

import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, it } from "@effect/vitest";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { ConfigProvider, Effect, Layer, Option, Ref, Stream } from "effect";
import { HttpEffect, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as Reactivity from "effect/reactivity/Reactivity";
import * as SqlClient from "effect/sql/SqlClient";

import * as OAuthProviders from "../src/auth/OAuthProviders.ts";
import * as Database from "../src/database/Database.ts";
import * as Analytics from "../src/website/Analytics.ts";
import * as Jwt from "../src/website/Jwt.ts";
import * as Password from "../src/website/Password.ts";
import * as WebsiteRoutes from "../src/website/WebsiteRoutes.ts";

const origin = "https://www.macrograph.app";

// Produced by the original website's `new Argon2id().hash("correct horse battery")` (oslo).
const osloHash =
  "$argon2id$v=19$m=19456,t=2,p=1$XnQZkq9zgTb41DVRiMpllg$g4MVhjmvkFDc8ZkskPF114cHgIf7/QoBubz2PkDUD6w";

const generateRsaPem = Effect.promise(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const body = btoa(String.fromCharCode(...der)).replace(/(.{64})/g, "$1\\n");
  // Environment variables store the PEM with escaped newlines.
  return `-----BEGIN PRIVATE KEY-----\\n${body}\\n-----END PRIVATE KEY-----`;
});

// Every query finds nothing, which exercises the routes' not-found paths.
const emptyDatabaseLayer = Layer.effect(Database.Service)(
  Effect.gen(function* () {
    const unsupported = () => Effect.die("Unexpected SQL operation");
    const execute: SqlConnection.Connection["executeValues"] = () => Effect.succeed([]);
    const connection: SqlConnection.Connection = {
      execute: (sql, params) => execute(sql, params).pipe(Effect.as([])),
      executeRaw: execute,
      executeUnprepared: unsupported,
      executeValuesUnprepared: unsupported,
      executeStream: () => Stream.die("Unexpected SQL stream"),
      executeValues: execute,
    };
    const sql = yield* SqlClient.make({
      acquirer: Effect.succeed(connection),
      compiler: PgClient.makeCompiler(),
      spanAttributes: [],
    });
    const client: PgClient.PgClient = Object.assign(sql, {
      [PgClient.TypeId]: PgClient.TypeId,
      config: {},
      json: (value: unknown) => JSON.stringify(value),
      listen: () => Stream.die("Unexpected SQL listener"),
      notify: unsupported,
    });
    return yield* PgDrizzle.makeWithDefaults().pipe(
      Effect.provideService(PgClient.PgClient, client),
    );
  }),
).pipe(Layer.provide(Reactivity.layer));

const providersLayer = OAuthProviders.layer.pipe(
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({ TWITCH_CLIENT_ID: "client", TWITCH_CLIENT_SECRET: "secret" }),
    ),
  ),
);

const makeApp = Effect.gen(function* () {
  const shares = new Map<string, string>();
  const stateKey = yield* Jwt.hmacKey("state-secret");
  return yield* WebsiteRoutes.layer({
    stateKey: Effect.succeed(stateKey),
    serverKey: Effect.succeed(undefined),
    authRedirectOrigin: origin,
    capture: Analytics.disabled,
    shares: {
      get: (id) => Effect.sync(() => shares.get(id) ?? null),
      put: (id, value) => Effect.sync(() => void shares.set(id, value)),
    },
    fetch: async (url) =>
      String(url).endsWith("/darwin-aarch64/latest")
        ? Response.json({ version: "1.2.3" })
        : new Response(null, { status: 404 }),
  }).pipe(Layer.provide([emptyDatabaseLayer, providersLayer]), HttpRouter.toHttpEffect);
});

const send = (
  app: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    unknown,
    HttpServerRequest.HttpServerRequest
  >,
  path: string,
  init?: RequestInit,
) =>
  Effect.gen(function* () {
    const response = yield* Ref.make(Option.none<HttpServerResponse.HttpServerResponse>());
    yield* HttpEffect.toHandled(app, (_, value) => Ref.set(response, Option.some(value))).pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(
          new Request(`${origin}${path}`, {
            ...init,
            // Cloudflare provides the host header; undici does not let a Request set it.
            headers: { "x-forwarded-host": new URL(origin).host, ...init?.headers },
          }),
        ),
      ),
    );
    return HttpServerResponse.toWeb(Option.getOrThrow(yield* Ref.get(response)));
  });

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

describe("website passwords", () => {
  it.effect("verifies hashes created by the original website", () =>
    Effect.gen(function* () {
      assert.isTrue(yield* Password.verify(osloHash, "correct horse battery"));
      assert.isFalse(yield* Password.verify(osloHash, "correct horse batteries"));
    }),
  );

  it.effect("hashes in the original PHC format", () =>
    Effect.gen(function* () {
      const hash = yield* Password.hash("hunter2hunter2");
      assert.match(
        hash,
        /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
      );
      assert.isTrue(yield* Password.verify(hash, "hunter2hunter2"));
    }),
  );

  it.effect("rejects malformed and excessive parameters", () =>
    Effect.gen(function* () {
      assert.isFalse(yield* Password.verify("not a hash", "password"));
      assert.isFalse(
        yield* Password.verify(osloHash.replace("m=19456", "m=4194304"), "correct horse battery"),
      );
    }),
  );
});

describe("website JWTs", () => {
  it.effect("signs and verifies server tokens with an escaped PEM key", () =>
    Effect.gen(function* () {
      const key = yield* Jwt.rsaKey(yield* generateRsaPem);
      const token = yield* Jwt.sign(key, { oauthAppId: "app", ownerId: "user", iat: 1 });
      assert.deepStrictEqual(yield* Jwt.verify(key, token), {
        oauthAppId: "app",
        ownerId: "user",
        iat: 1,
      });
      assert.isUndefined(yield* Jwt.verify(key, `${token.slice(0, -2)}AA`));
      assert.isUndefined(yield* Jwt.verify(yield* Jwt.hmacKey("secret"), token));
    }),
  );

  it.effect("rejects expired tokens", () =>
    Effect.gen(function* () {
      const key = yield* Jwt.hmacKey("secret");
      const expired = yield* Jwt.sign(key, { exp: Math.floor(Date.now() / 1000) - 1 });
      assert.isUndefined(yield* Jwt.verify(key, expired));
    }),
  );
});

describe("website routes", () => {
  it.effect("keeps the original device and registration error shapes", () =>
    Effect.gen(function* () {
      const app = yield* makeApp;
      const grant = yield* send(
        app,
        "/api/login/oauth/access_token?device_code=missing&grant_type=urn:ietf:params:oauth:grant-type:device_code",
        { method: "POST" },
      );
      assert.strictEqual(grant.status, 400);
      assert.deepStrictEqual(yield* Effect.promise(() => grant.json()), {
        code: "incorrect_device_code",
        _tag: "DeviceFlowError",
      });

      const registration = yield* send(app, "/api/server/registration", json({ id: "missing" }));
      assert.strictEqual(registration.status, 400);
      assert.deepStrictEqual(yield* Effect.promise(() => registration.json()), {
        code: "incorrect_id",
        _tag: "ServerRegistrationError",
      });

      const anonymous = yield* send(app, "/api/credentials");
      assert.strictEqual(anonymous.status, 403);
      const user = yield* send(app, "/api/user");
      assert.isNull(yield* Effect.promise(() => user.json()));
    }),
  );

  it.effect("only lets the Cloud origin use the session bridge", () =>
    Effect.gen(function* () {
      const app = yield* makeApp;
      const preflight = yield* send(app, "/api/cloud-login", {
        method: "OPTIONS",
        headers: {
          origin: WebsiteRoutes.cloudOrigin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
      assert.strictEqual(preflight.status, 204);
      assert.strictEqual(
        preflight.headers.get("access-control-allow-origin"),
        WebsiteRoutes.cloudOrigin,
      );

      const foreign = yield* send(
        app,
        "/api/cloud-login",
        json({ userCode: "ABCD-EFGH" }, { origin: "https://example.com" }),
      );
      assert.strictEqual(foreign.status, 403);
      assert.isNull(foreign.headers.get("access-control-allow-origin"));

      const signedOut = yield* send(
        app,
        "/api/cloud-login",
        json({ userCode: "ABCD-EFGH" }, { origin: WebsiteRoutes.cloudOrigin }),
      );
      assert.strictEqual(signedOut.status, 401);
    }),
  );

  it.effect("routes desktop OAuth through the registered proxy", () =>
    Effect.gen(function* () {
      const app = yield* makeApp;
      const state = btoa(JSON.stringify({ env: "desktop", port: 1820 }));
      const login = yield* send(app, `/auth/twitch/login?state=${state}`);
      assert.strictEqual(login.status, 302);
      const authorize = new URL(login.headers.get("location") ?? "");
      assert.strictEqual(authorize.origin, "https://id.twitch.tv");
      assert.strictEqual(authorize.searchParams.get("redirect_uri"), `${origin}/auth/proxy`);

      const proxy = yield* send(
        app,
        `/auth/proxy?code=code&state=${authorize.searchParams.get("state")}`,
      );
      assert.strictEqual(proxy.status, 302);
      assert.isTrue(
        proxy.headers.get("location")?.startsWith(`${origin}/auth/twitch/callback?code=code`),
      );

      const spoofed = yield* send(app, `/auth/twitch/login?state=${state}`, {
        headers: { "x-forwarded-host": "attacker.example" },
      });
      const spoofedState = new URL(spoofed.headers.get("location") ?? "").searchParams.get("state");
      const spoofedProxy = yield* send(app, `/auth/proxy?code=code&state=${spoofedState}`);
      assert.isTrue(
        spoofedProxy.headers.get("location")?.startsWith(`${origin}/auth/twitch/callback`),
      );

      const forged = yield* send(app, "/auth/proxy?code=code&state=forged");
      assert.strictEqual(forged.status, 400);

      // Tokens are posted to the opener, so foreign origins cannot start the web flow.
      const web = btoa(JSON.stringify({ env: "web", targetOrigin: "https://example.com" }));
      const foreign = yield* send(app, `/auth/twitch/login?state=${web}`);
      assert.strictEqual(foreign.status, 400);
    }),
  );

  it.effect("redirects desktop downloads and stores playground shares", () =>
    Effect.gen(function* () {
      const app = yield* makeApp;
      const download = yield* send(app, "/api/desktop/download/latest/darwin-aarch64");
      assert.strictEqual(download.status, 302);
      assert.strictEqual(
        download.headers.get("location"),
        "https://cdn.crabnebula.app/download/macrograph/macrograph/latest/MacroGraph_1.2.3_aarch64.dmg",
      );
      const unknown = yield* send(app, "/api/desktop/download/latest/amiga");
      assert.strictEqual(unknown.status, 404);

      const crossOrigin = yield* send(
        app,
        "/api/website/playground",
        json({ project: "{}" }, { origin: "https://example.com" }),
      );
      assert.strictEqual(crossOrigin.status, 403);
      const saved = yield* send(
        app,
        "/api/website/playground",
        json({ project: '{"name":"Shared"}' }, { origin }),
      );
      const { id } = yield* Effect.promise(() => saved.json());
      const loaded = yield* send(app, `/api/website/playground/${id}`);
      assert.strictEqual(yield* Effect.promise(() => loaded.json()), '{"name":"Shared"}');
    }),
  );
});
