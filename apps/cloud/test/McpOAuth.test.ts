import type * as SqlConnection from "effect/unstable/sql/SqlConnection";

import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, it } from "@effect/vitest";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Effect, Layer, Option, Ref, Stream } from "effect";
import {
  HttpEffect,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as McpOAuth from "../src/auth/McpOAuth.ts";
import * as Database from "../src/database/Database.ts";

const redirectUri = "vscode://macrograph/oauth/callback";
const verifier = "macrograph-oauth-test-verifier-which-is-long-enough-123";

const databaseLayer = Layer.effect(Database.Service)(
  Effect.gen(function* () {
    let tokenExchanges = 0;
    const unsupported = () => Effect.die("Unexpected SQL operation");
    const execute: SqlConnection.Connection["executeValues"] = (sql) =>
      Effect.sync(() => {
        if (sql.includes('insert into "oauth_clients"')) return [];
        if (sql.includes('from "oauth_clients"')) return [["OpenCode", [redirectUri]]];
        if (sql.includes('insert into "oauth_authorization_codes"')) return [];
        if (sql.includes('delete from "oauth_authorization_codes"'))
          return tokenExchanges++ === 0 ? [["user-1", "mcp"]] : [];
        if (sql.includes('insert into "oauth_access_tokens"')) return [];
        throw new Error(`Unexpected query: ${sql}`);
      });
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
        HttpServerRequest.fromWeb(new Request(`https://cloud.macrograph.app${path}`, init)),
      ),
    );
    return Option.getOrThrow(yield* Ref.get(response));
  });

describe("MCP OAuth", () => {
  it.effect("registers a native client and completes a single-use PKCE flow", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const app = yield* McpOAuth.layer({
          authenticateSession: () => Effect.succeed({ userId: "user-1", sessionId: "session-1" }),
          limitRegistration: () => Effect.succeed({ success: true }),
        }).pipe(Layer.provide(databaseLayer), HttpRouter.toHttpEffect);

        const metadata = yield* send(app, "/.well-known/oauth-protected-resource/api/mcp");
        const metadataBody = yield* Effect.promise(() => HttpServerResponse.toWeb(metadata).json());
        assert.strictEqual(metadataBody.resource, "https://cloud.macrograph.app/api/mcp");

        const registered = yield* send(app, "/oauth/register", {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.1" },
          body: JSON.stringify({
            client_name: "OpenCode",
            redirect_uris: [redirectUri],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "client_secret_post",
          }),
        });
        assert.strictEqual(registered.status, 201);
        const registration = yield* Effect.promise(() =>
          HttpServerResponse.toWeb(registered).json(),
        );
        assert.isString(registration.client_id);
        assert.deepStrictEqual(registration.grant_types, ["authorization_code"]);
        assert.strictEqual(registration.token_endpoint_auth_method, "none");

        const unsupportedGrant = yield* send(app, "/oauth/register", {
          method: "POST",
          headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.1" },
          body: JSON.stringify({
            redirect_uris: [redirectUri],
            grant_types: ["client_credentials"],
          }),
        });
        assert.strictEqual(unsupportedGrant.status, 400);

        const challenge = yield* Effect.promise(() =>
          crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)).then((digest) =>
            btoa(String.fromCharCode(...new Uint8Array(digest)))
              .replaceAll("+", "-")
              .replaceAll("/", "_")
              .replace(/=+$/, ""),
          ),
        );
        const authorization = new URLSearchParams({
          response_type: "code",
          client_id: registration.client_id,
          redirect_uri: redirectUri,
          code_challenge: challenge,
          code_challenge_method: "S256",
          resource: "https://cloud.macrograph.app/api/mcp",
          scope: "mcp",
          state: "state-1",
        });
        const consent = yield* send(app, `/oauth/authorize?${authorization}`);
        assert.include(
          yield* Effect.promise(() => HttpServerResponse.toWeb(consent).text()),
          "OpenCode",
        );

        const invalidScope = new URLSearchParams(authorization);
        invalidScope.set("scope", "admin");
        const rejected = yield* send(app, `/oauth/authorize?${invalidScope}`);
        assert.include(rejected.headers.location, "error=invalid_scope");
        assert.include(rejected.headers.location, "state=state-1");

        authorization.set("decision", "allow");
        const approved = yield* send(app, "/oauth/authorize", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: authorization.toString(),
        });
        const code = new URL(approved.headers.location).searchParams.get("code");
        assert.isString(code);

        const tokenBody = new URLSearchParams({
          grant_type: "authorization_code",
          client_id: registration.client_id,
          redirect_uri: redirectUri,
          code,
          code_verifier: verifier,
          resource: "https://cloud.macrograph.app/api/mcp",
        }).toString();
        const token = yield* send(app, "/oauth/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: tokenBody,
        });
        const tokenJson = yield* Effect.promise(() => HttpServerResponse.toWeb(token).json());
        assert.match(tokenJson.access_token, /^mgo_/);

        const replay = yield* send(app, "/oauth/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: tokenBody,
        });
        assert.strictEqual(
          (yield* Effect.promise(() => HttpServerResponse.toWeb(replay).json())).error,
          "invalid_grant",
        );
      }),
    ),
  );
});
