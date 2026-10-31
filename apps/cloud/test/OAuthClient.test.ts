import type { PGlite } from "@electric-sql/pglite";

import { assert, describe, it } from "@effect/vitest";
import { CloudCredentials } from "@macrograph/cloud-credentials";
import { Effect, Layer } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { type App, type Harness, harness, origin, send, signIn, website } from "./OAuthHarness.ts";

class MemoryStore implements CloudCredentials.SessionStore {
  value: string | null = null;
  read = Effect.sync(() => this.value);
  write = (value: string) =>
    Effect.sync(() => {
      this.value = value;
    });
  clear = Effect.sync(() => {
    this.value = null;
  });
  get parsed(): Record<string, unknown> {
    return JSON.parse(this.value ?? "{}") as Record<string, unknown>;
  }
}

/** Sends the client's requests straight into the website's routes. */
const httpClient = (app: App) =>
  Layer.succeed(HttpClient.HttpClient)(
    HttpClient.make((request) =>
      Effect.gen(function* () {
        const url = new URL(request.url);
        assert.strictEqual(url.origin, origin);
        const response = yield* send(app, `${url.pathname}${url.search}`, {
          method: request.method,
          headers: request.headers,
          ...(request.body._tag === "Uint8Array" ? { body: request.body.body } : {}),
        });
        return HttpClientResponse.fromWeb(request, response);
      }),
    ),
  );

const server = (setup: Harness, store = new MemoryStore(), name = "Brendan's server") =>
  CloudCredentials.make({
    store,
    issuer: origin,
    now: setup.now,
    client: { type: "registered", name, softwareId: "macrograph-server" },
  }).pipe(
    Effect.provide(httpClient(setup.app)),
    Effect.map((client) => ({ client, store })),
  );

const addTwitchCredential = (pg: PGlite, userId: string) =>
  Effect.promise(() =>
    pg.query(
      `insert into "oauth_credential" (provider_id, user_id, provider_user_id, token, token_created_at, display_name) values ('twitch', $1, '42', $2, now(), 'brendan')`,
      [
        userId,
        JSON.stringify({
          access_token: "twitch-access",
          refresh_token: "twitch-refresh",
          expires_in: 3600,
          token_type: "bearer",
        }),
      ],
    ),
  );

const approve = (app: App, session: Record<string, string>, userCode: unknown) =>
  website(app, session, "device/approve", { userCode }).pipe(
    Effect.tap((response) => Effect.sync(() => assert.strictEqual(response.status, 200))),
  );

const scoped = <A, E>(test: (setup: Harness) => Effect.Effect<A, E>) =>
  Effect.scoped(Effect.flatMap(harness, test));

// Each test starts its own in-memory Postgres with every migration applied.
describe("OAuth client against the authorization server", { timeout: 30_000 }, () => {
  it.effect("registers, connects the owner, and reads credentials through rotating tokens", () =>
    scoped((setup) =>
      Effect.gen(function* () {
        const session = yield* signIn(setup.pg, "owner");
        yield* addTwitchCredential(setup.pg, "owner");
        const { client, store } = yield* server(setup);
        let notifications = 0;
        yield* client.credentials.subscribe(() =>
          Effect.sync(() => {
            notifications++;
          }),
        );

        const pending = yield* client.auth.start;
        assert.strictEqual(pending.state, "pending");
        if (pending.state !== "pending") return;
        assert.isTrue(pending.verificationUrl.startsWith(`${origin}/device?user_code=`));
        assert.match(pending.userCode ?? "", /^[A-Z]{4}-[A-Z]{4}$/);
        assert.match(String((store.parsed.client as Record<string, unknown>).clientId), /^mgc_/);

        // Too soon to poll: the client waits out the interval without asking the server.
        assert.strictEqual((yield* client.auth.poll).state, "pending");
        yield* approve(setup.app, session, pending.userCode);
        setup.advance(6_000);
        const connected = yield* client.pollOwner("owner");
        assert.deepStrictEqual(connected, {
          state: "connected",
          identity: { id: "owner", displayName: "owner@example.com" },
        });

        const catalog = yield* client.credentials.catalog;
        assert.strictEqual(catalog._tag, "CredentialCatalogAvailable");
        const [credential] = yield* client.credentials.get;
        assert.strictEqual(credential?.provider, "twitch");

        const firstRefreshToken = (store.parsed.grant as Record<string, unknown>).refreshToken;
        setup.advance(2 * 60 * 60 * 1000);
        const refetched = yield* client.credentials.refetch;
        assert.strictEqual(refetched._tag, "CredentialCatalogAvailable");
        assert.notStrictEqual(
          (store.parsed.grant as Record<string, unknown>).refreshToken,
          firstRefreshToken,
        );

        // Removing the app on the website cuts the server off.
        const listed = yield* send(setup.app, "/api/website/authorizations", { headers: session });
        const [grant] = (yield* Effect.promise(() => listed.json())) as ReadonlyArray<{
          readonly id: string;
        }>;
        yield* send(setup.app, `/api/website/authorizations/${grant!.id}`, {
          method: "DELETE",
          headers: session,
        });
        setup.advance(2 * 60 * 60 * 1000);
        const afterRevoke = yield* client.credentials.refetch;
        assert.strictEqual(afterRevoke._tag, "CredentialCatalogUnavailable");
        assert.deepStrictEqual(yield* client.auth.status, { state: "disconnected" });
        assert.isAbove(notifications, 0);
        // The registration survives, so reconnecting needs only a new approval.
        assert.property(store.parsed, "client");
        assert.notProperty(store.parsed, "grant");
      }),
    ),
  );

  it.effect("only accepts the expected owner when reconnecting", () =>
    scoped((setup) =>
      Effect.gen(function* () {
        const intruder = yield* signIn(setup.pg, "intruder");
        const { client, store } = yield* server(setup);
        const pending = yield* client.auth.start;
        if (pending.state !== "pending") return assert.fail("expected a pending authorization");
        yield* approve(setup.app, intruder, pending.userCode);
        setup.advance(6_000);
        const result = yield* Effect.flip(client.pollOwner("owner"));
        assert.include(result.reason, "server owner");
        assert.notProperty(store.parsed, "grant");
        assert.deepStrictEqual(yield* client.auth.status, { state: "disconnected" });
      }),
    ),
  );

  it.effect("signs users in with a one-off device flow", () =>
    scoped((setup) =>
      Effect.gen(function* () {
        const session = yield* signIn(setup.pg, "visitor");
        const { client } = yield* server(setup);
        const started = yield* client.signIn.start;
        assert.isTrue(started.verificationUrl.endsWith(`user_code=${started.userCode}`));
        assert.strictEqual((yield* client.signIn.poll(started.deviceCode)).state, "pending");
        yield* approve(setup.app, session, started.userCode);
        setup.advance(6_000);
        assert.deepStrictEqual(yield* client.signIn.poll(started.deviceCode), {
          state: "connected",
          userId: "visitor",
          email: "visitor@example.com",
        });
        // Signing in never creates a lasting grant.
        const listed = yield* send(setup.app, "/api/website/authorizations", { headers: session });
        assert.deepStrictEqual(yield* Effect.promise(() => listed.json()), []);
      }),
    ),
  );

  it.effect("reports denied sign-ins", () =>
    scoped((setup) =>
      Effect.gen(function* () {
        const session = yield* signIn(setup.pg, "visitor");
        const { client } = yield* server(setup);
        const started = yield* client.signIn.start;
        yield* website(setup.app, session, "device/deny", { userCode: started.userCode });
        setup.advance(6_000);
        const error = yield* Effect.flip(client.signIn.poll(started.deviceCode));
        assert.strictEqual(error.code, "authorization-denied");
      }),
    ),
  );

  it.effect("registers again when the server forgets the client, and keeps its name current", () =>
    scoped((setup) =>
      Effect.gen(function* () {
        const store = new MemoryStore();
        const first = yield* server(setup, store);
        yield* first.client.signIn.start;
        const clientId = (store.parsed.client as Record<string, unknown>).clientId;

        const renamed = yield* server(setup, store, "Renamed server");
        yield* renamed.client.signIn.start;
        const rows = yield* Effect.promise(() =>
          setup.pg.query<{ name: string }>(`select name from auth_clients where id = $1`, [
            clientId,
          ]),
        );
        assert.strictEqual(rows.rows[0]?.name, "Renamed server");

        yield* Effect.promise(() => setup.pg.query(`delete from auth_clients`));
        yield* renamed.client.signIn.start;
        assert.notStrictEqual((store.parsed.client as Record<string, unknown>).clientId, clientId);
      }),
    ),
  );
});
