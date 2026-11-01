import type { PGlite } from "@electric-sql/pglite";

import { assert, describe, it } from "@effect/vitest";
import { ApiCaller } from "@macrograph/project-api";
import { ConfigProvider, Effect, Fiber, Layer } from "effect";
import { HttpClient, type HttpClientRequest, HttpClientResponse, HttpRouter } from "effect/http";
import { DatabaseSync } from "node:sqlite";

import type { ConfigureRequest, Status } from "../src/gateway/GatewayDO.ts";

import * as Authentication from "../src/auth/Authentication.ts";
import * as OAuthProviders from "../src/auth/OAuthProviders.ts";
import { EventLog } from "../src/gateway/EventLog.ts";
import { Gateway } from "../src/gateway/Gateway.ts";
import { GatewayHttp } from "../src/gateway/GatewayHttp.ts";
import { GatewayMcp } from "../src/gateway/GatewayMcp.ts";
import { type App, body, send, signIn } from "./OAuthHarness.ts";
import * as PgliteDatabase from "./PgliteDatabase.ts";

const providersLayer = OAuthProviders.layer.pipe(
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({ TWITCH_CLIENT_ID: "client", TWITCH_CLIENT_SECRET: "secret" }),
    ),
  ),
);

const connectTwitch = (pg: PGlite, userId: string, accountId: string, displayName: string) =>
  Effect.promise(() =>
    pg.query(
      `insert into "oauth_credential" (provider_id, user_id, provider_user_id, token, token_created_at, display_name) values ('twitch', $1, $2, $3, now(), $4)`,
      [
        userId,
        accountId,
        JSON.stringify({
          access_token: `token-${accountId}`,
          expires_in: 3600,
          token_type: "bearer",
        }),
        displayName,
      ],
    ),
  );

/** An in-memory stand-in for a user's GatewayDO. */
const fakeObject = () => {
  const database = new DatabaseSync(":memory:");
  const log = EventLog.make({
    exec: (query, ...bindings) => {
      const rows = database.prepare(query).all(...bindings);
      return { toArray: () => rows as ReadonlyArray<Record<string, unknown>> };
    },
  });
  const configured: Array<ConfigureRequest> = [];
  const status = (): Status => {
    const last = configured.at(-1);
    return {
      subscriptions: {
        twitch: last?.subscriptions.twitch ?? {},
        github: last?.subscriptions.github ?? [],
        discord: null,
      },
      discord: { status: "off", error: null },
      error: null,
    };
  };
  const object: GatewayHttp.GatewayObject = {
    configure: (request) =>
      Effect.sync(() => {
        configured.push(request);
        return status();
      }),
    status: () => Effect.sync(status),
    ingress: () => Effect.succeed({ status: 404 }),
    events: ({ after, limit }) =>
      Effect.sync(() =>
        after === undefined ? log.latest(limit).toReversed() : log.after(after, limit),
      ),
    webhooks: () => Effect.sync(() => log.webhooks().map(({ secret: _, ...webhook }) => webhook)),
    addWebhook: (request) => Effect.sync(() => log.addWebhook(request)),
    removeWebhook: (id) => Effect.sync(() => log.removeWebhook(id)),
    deliveries: (webhookId) => Effect.sync(() => log.deliveries(webhookId)),
    stream: () => Effect.die("unused"),
  };
  return { object, log, configured };
};

const setupWith = (options: { readonly allowedUsers: string }) =>
  Effect.gen(function* () {
    const pg = yield* PgliteDatabase.make;
    const requests: Array<HttpClientRequest.HttpClientRequest> = [];
    const http = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          requests.push(request);
          return HttpClientResponse.fromWeb(request, Response.json({ data: [{ ok: true }] }));
        }),
      ),
    );
    const database = PgliteDatabase.layer(pg);
    const gateway = Gateway.layer.pipe(
      Layer.provide([
        database,
        providersLayer,
        http,
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({ GATEWAY_ALLOWED_USERS: options.allowedUsers }),
        ),
      ]),
    );
    const authentication = yield* Authentication.Service.pipe(
      Effect.provide(Authentication.layer.pipe(Layer.provide(database))),
    );
    const object = fakeObject();
    const routes: App = yield* Layer.mergeAll(
      GatewayHttp.layer({
        objects: () => object.object,
        authenticateSession: authentication.authenticateSession,
        ingressOrigin: () => "https://ingress.example",
      }),
      GatewayMcp.layer({ approvalWaitMs: 10_000 }),
    ).pipe(Layer.provide([gateway, database]), HttpRouter.toHttpEffect);
    const session = yield* signIn(pg, "owner");
    const agent = ApiCaller.forApiKey({ id: "key", name: "Agent" }, null);
    // As CloudWorker serves it: MCP requests run as the bearer's user.
    const mcpApp: App = GatewayMcp.authenticated(
      routes,
      Effect.succeed({ user: { id: "owner" }, caller: agent }),
    );
    let nextId = 1;
    const rpc = (method: string, params: unknown = {}) =>
      send(mcpApp, GatewayMcp.path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
      }).pipe(
        Effect.flatMap(body),
        Effect.map((response) => response.result as Record<string, unknown>),
      );
    const call = (name: string, args: Record<string, unknown>) =>
      rpc("tools/call", { name, arguments: args }).pipe(
        Effect.map((result) => ({
          isError: result.isError as boolean,
          text: (result.content as ReadonlyArray<{ readonly text: string }>)[0]?.text ?? "",
        })),
      );
    const website = (path: string, init?: RequestInit) =>
      send(routes, `${GatewayHttp.managePrefix}${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...session, ...init?.headers },
      });
    const api = (path: string, key: string, init?: RequestInit) =>
      send(routes, `${GatewayHttp.apiPrefix}${path}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${key}`,
          ...init?.headers,
        },
      });
    const toolNames = rpc("tools/list").pipe(
      Effect.map((result) =>
        (result.tools as ReadonlyArray<{ readonly name: string }>).map((tool) => tool.name),
      ),
    );
    return { pg, requests, call, website, api, toolNames, object };
  });

const setup = setupWith({ allowedUsers: "someone-else, owner" });

const list = (website: (path: string) => Effect.Effect<Response>) =>
  website("/approvals").pipe(
    Effect.flatMap((response) =>
      Effect.promise(
        () =>
          response.json() as Promise<
            ReadonlyArray<{ readonly id: string; readonly status: string }>
          >,
      ),
    ),
  );

const pendingApproval = (website: (path: string) => Effect.Effect<Response>) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 50; attempt++) {
      const approvals = yield* list(website);
      const pending = approvals.find((approval) => approval.status === "pending");
      if (pending !== undefined) return pending;
      yield* Effect.sleep(20);
    }
    return yield* Effect.die("No approval was requested");
  });

describe("Gateway", { timeout: 30_000 }, () => {
  it.live("lists tools only for connected providers", () =>
    Effect.gen(function* () {
      const { pg, toolNames } = yield* setup;
      assert.deepStrictEqual(yield* toolNames, [
        GatewayMcp.listAccountsTool,
        GatewayMcp.awaitApprovalTool,
      ]);

      yield* connectTwitch(pg, "owner", "1234", "brendonovich");
      const names = yield* toolNames;
      assert.include(names, "twitch_get_chatters");
      assert.include(names, "twitch_ban_user");
      assert.isFalse(names.some((name) => name.startsWith("github_")));
    }).pipe(Effect.scoped),
  );

  it.live("runs writes immediately once the user allows them", () =>
    Effect.gen(function* () {
      const { pg, requests, call, website } = yield* setup;
      yield* connectTwitch(pg, "owner", "1234", "brendonovich");

      const blocked = yield* website("/tools/twitch_ban_user", {
        method: "PUT",
        body: JSON.stringify({ policy: "block" }),
      });
      assert.strictEqual(blocked.status, 400);

      const allowed = yield* website("/tools/twitch_ban_user", {
        method: "PUT",
        body: JSON.stringify({ policy: "allow" }),
      });
      assert.strictEqual(allowed.status, 204);
      const result = yield* call("twitch_ban_user", { userId: "99" });
      assert.isFalse(result.isError);
      assert.strictEqual(JSON.parse(result.text).status, 200);
      assert.lengthOf(requests, 1);
      assert.deepStrictEqual(yield* list(website), []);
    }).pipe(Effect.scoped),
  );

  it.live("runs allowed reads immediately as the connected account", () =>
    Effect.gen(function* () {
      const { pg, requests, call } = yield* setup;
      yield* connectTwitch(pg, "owner", "1234", "brendonovich");

      const result = yield* call("twitch_get_chatters", {});
      assert.isFalse(result.isError);
      assert.deepStrictEqual(JSON.parse(result.text), {
        status: 200,
        body: { data: [{ ok: true }] },
      });
      const request = requests[0];
      assert.strictEqual(request?.url, "https://api.twitch.tv/helix/chat/chatters");
      assert.strictEqual(request?.headers.authorization, "Bearer token-1234");
      assert.strictEqual(request?.headers["client-id"], "client");
      assert.deepInclude(request?.urlParams.params, ["broadcaster_id", "1234"]);
      assert.deepInclude(request?.urlParams.params, ["moderator_id", "1234"]);
    }).pipe(Effect.scoped),
  );

  it.live("holds writes until the user approves, then runs the approved arguments", () =>
    Effect.gen(function* () {
      const { pg, requests, call, website } = yield* setup;
      yield* connectTwitch(pg, "owner", "1234", "brendonovich");

      const pendingCall = yield* Effect.forkChild(
        call("twitch_ban_user", { userId: "99", reason: "spam" }),
      );
      const approval = yield* pendingApproval(website);
      assert.lengthOf(requests, 0);

      const approved = yield* website(`/approvals/${approval.id}/approve`, { method: "POST" });
      assert.strictEqual(approved.status, 200);
      assert.strictEqual((yield* body(approved)).status, "succeeded");

      const result = yield* Fiber.join(pendingCall);
      assert.isFalse(result.isError);
      assert.strictEqual(JSON.parse(result.text).status, 200);
      assert.lengthOf(requests, 1);
      assert.strictEqual(requests[0]?.method, "POST");
      assert.strictEqual(requests[0]?.url, "https://api.twitch.tv/helix/moderation/bans");

      const again = yield* website(`/approvals/${approval.id}/approve`, { method: "POST" });
      assert.strictEqual(again.status, 409);
      assert.lengthOf(requests, 1);
    }).pipe(Effect.scoped),
  );

  it.live("tells the agent when the user denies a call", () =>
    Effect.gen(function* () {
      const { pg, requests, call, website } = yield* setup;
      yield* connectTwitch(pg, "owner", "1234", "brendonovich");

      const pendingCall = yield* Effect.forkChild(call("twitch_ban_user", { userId: "99" }));
      const approval = yield* pendingApproval(website);
      assert.strictEqual(
        (yield* website(`/approvals/${approval.id}/deny`, { method: "POST" })).status,
        200,
      );

      const result = yield* Fiber.join(pendingCall);
      assert.isTrue(result.isError);
      assert.include(result.text, "denied");
      assert.lengthOf(requests, 0);
    }).pipe(Effect.scoped),
  );

  it.live("rejects invalid calls before asking for approval", () =>
    Effect.gen(function* () {
      const { pg, call, website } = yield* setup;
      yield* connectTwitch(pg, "owner", "1234", "brendonovich");
      const result = yield* call("twitch_ban_user", {});
      assert.isTrue(result.isError);
      assert.include(result.text, "userId");
      assert.deepStrictEqual(yield* list(website), []);
    }).pipe(Effect.scoped),
  );

  it.live("asks which account to use when several are connected", () =>
    Effect.gen(function* () {
      const { pg, requests, call } = yield* setup;
      yield* connectTwitch(pg, "owner", "1", "first");
      yield* connectTwitch(pg, "owner", "2", "second");

      const ambiguous = yield* call("twitch_get_chatters", {});
      assert.isTrue(ambiguous.isError);
      assert.include(ambiguous.text, "second (2)");

      assert.isFalse((yield* call("twitch_get_chatters", { account: "Second" })).isError);
      assert.strictEqual(requests[0]?.headers.authorization, "Bearer token-2");
    }).pipe(Effect.scoped),
  );

  it.live("is unavailable to accounts outside the allowlist", () =>
    Effect.gen(function* () {
      const { pg, requests, call, website, toolNames } = yield* setupWith({
        allowedUsers: "someone-else",
      });
      yield* connectTwitch(pg, "owner", "1234", "brendonovich");

      assert.deepStrictEqual(yield* toolNames, []);
      const result = yield* call("twitch_get_chatters", {});
      assert.isTrue(result.isError);
      assert.include(result.text, "isn't enabled");
      assert.lengthOf(requests, 0);

      assert.deepStrictEqual(yield* body(yield* website("/access")), { enabled: false });
      assert.strictEqual((yield* website("/tools")).status, 404);
      assert.strictEqual((yield* website("/approvals")).status, 404);
      assert.strictEqual(
        (yield* website("/tools/twitch_ban_user", {
          method: "PUT",
          body: JSON.stringify({ policy: "allow" }),
        })).status,
        404,
      );
    }).pipe(Effect.scoped),
  );

  it.live("only lets the website session manage policies and approvals", () =>
    Effect.gen(function* () {
      const { website } = yield* setup;
      assert.strictEqual((yield* website("/approvals", { headers: { cookie: "" } })).status, 401);
      assert.strictEqual(
        (yield* website("/tools/twitch_ban_user", {
          method: "PUT",
          headers: { origin: "https://evil.example" },
          body: JSON.stringify({ policy: "allow" }),
        })).status,
        401,
      );
      assert.strictEqual(
        (yield* website("/tools/not_a_tool", {
          method: "PUT",
          body: JSON.stringify({ policy: "allow" }),
        })).status,
        404,
      );
    }).pipe(Effect.scoped),
  );

  it.live("serves tools over HTTP to gateway API keys, with approvals", () =>
    Effect.gen(function* () {
      const { pg, requests, website, api } = yield* setup;
      yield* connectTwitch(pg, "owner", "1234", "brendonovich");

      assert.strictEqual((yield* api("/tools", "mgw_nope")).status, 401);
      const created = yield* body(
        yield* website("/keys", { method: "POST", body: JSON.stringify({ name: "Script" }) }),
      );
      const key = String(created.key);
      assert.match(key, /^mgw_[0-9a-f]{64}$/);
      // A gateway key can't use the website's management routes.
      assert.strictEqual(
        (yield* website("/keys", { headers: { cookie: "", authorization: `Bearer ${key}` } }))
          .status,
        401,
      );

      const tools = (yield* body(yield* api("/tools", key))).tools as ReadonlyArray<{
        readonly name: string;
        readonly policy: string;
      }>;
      assert.deepInclude(
        tools.map(({ name, policy }) => ({ name, policy })),
        { name: "twitch_get_chatters", policy: "allow" },
      );

      const read = yield* api("/tools/twitch_get_chatters", key, { method: "POST", body: "{}" });
      assert.strictEqual(read.status, 200);
      assert.deepStrictEqual(yield* body(read), { status: 200, body: { data: [{ ok: true }] } });

      const write = yield* api("/tools/twitch_ban_user", key, {
        method: "POST",
        body: JSON.stringify({ arguments: { userId: "99" } }),
      });
      assert.strictEqual(write.status, 202);
      const approval = (yield* body(write)).approval as Record<string, unknown>;
      assert.strictEqual(approval.status, "pending");
      assert.strictEqual(approval.caller, 'API key "Script"');
      assert.lengthOf(requests, 1);

      yield* website(`/approvals/${String(approval.id)}/approve`, { method: "POST" });
      const decided = (yield* body(yield* api(`/approvals/${String(approval.id)}`, key)))
        .approval as Record<string, unknown>;
      assert.strictEqual(decided.status, "succeeded");
      assert.lengthOf(requests, 2);

      const keys = (yield* body(yield* website("/keys"))).keys as ReadonlyArray<{
        readonly id: string;
        readonly lastUsedAt: string | null;
      }>;
      assert.lengthOf(keys, 1);
      assert.isString(keys[0]?.lastUsedAt);
      assert.strictEqual(
        (yield* website(`/keys/${keys[0]?.id}`, { method: "DELETE" })).status,
        204,
      );
      assert.strictEqual((yield* api("/tools", key)).status, 401);
    }).pipe(Effect.scoped),
  );

  it.live("validates event subscriptions before applying them", () =>
    Effect.gen(function* () {
      const { pg, website, object } = yield* setup;
      yield* connectTwitch(pg, "owner", "1234", "brendonovich");

      const options = yield* body(yield* website("/subscriptions"));
      const twitch = (options.options as Record<string, Record<string, unknown>>).twitch;
      assert.include(twitch?.events, "channel.chat.message");

      const subscribe = (subscriptions: unknown) =>
        website("/subscriptions", { method: "PUT", body: JSON.stringify(subscriptions) });
      const empty = { twitch: {}, github: [], discord: null };
      assert.strictEqual(
        (yield* subscribe({ ...empty, twitch: { "999": ["channel.follow"] } })).status,
        400,
      );
      assert.strictEqual(
        (yield* subscribe({ ...empty, twitch: { "1234": ["not.a.type"] } })).status,
        400,
      );
      assert.strictEqual(
        (yield* subscribe({ ...empty, discord: { token: "t", intents: ["everything"] } })).status,
        400,
      );
      const applied = yield* subscribe({ ...empty, twitch: { "1234": ["channel.raid"] } });
      assert.strictEqual(applied.status, 200);
      assert.deepStrictEqual(object.configured.at(-1), {
        userId: "owner",
        publicOrigin: "https://ingress.example",
        subscriptions: { ...empty, twitch: { "1234": ["channel.raid"] } },
      });
    }).pipe(Effect.scoped),
  );

  it.live("manages webhooks and serves event history", () =>
    Effect.gen(function* () {
      const { website, api, object } = yield* setup;
      const insecure = yield* website("/webhooks", {
        method: "POST",
        body: JSON.stringify({ url: "http://example.com", events: [] }),
      });
      assert.strictEqual(insecure.status, 400);
      const created = yield* body(
        yield* website("/webhooks", {
          method: "POST",
          body: JSON.stringify({ url: "https://example.com/hook", events: ["twitch.*"] }),
        }),
      );
      assert.match(String(created.secret), /^mgws_/);
      const listed = (yield* body(yield* website("/webhooks"))).webhooks as ReadonlyArray<
        Record<string, unknown>
      >;
      assert.lengthOf(listed, 1);
      assert.notProperty(listed[0], "secret");

      object.log.append({
        id: "e1",
        source: "twitch",
        account: "1234",
        type: "channel.follow",
        data: { user: "a" },
      });
      object.log.append({ id: "e2", source: "github", account: "a/b", type: "push", data: {} });

      const key = String(
        (yield* body(
          yield* website("/keys", { method: "POST", body: JSON.stringify({ name: "Events" }) }),
        )).key,
      );
      const page = (yield* body(yield* api("/events?after=1", key))).events as ReadonlyArray<{
        readonly id: string;
      }>;
      assert.deepStrictEqual(
        page.map((event) => event.id),
        ["e2"],
      );
      const deliveries = (yield* body(yield* website(`/webhooks/${String(created.id)}/deliveries`)))
        .deliveries as ReadonlyArray<{ readonly eventSeq: number }>;
      assert.deepStrictEqual(
        deliveries.map((delivery) => delivery.eventSeq),
        [1],
      );
      assert.strictEqual(
        (yield* website(`/webhooks/${String(created.id)}`, { method: "DELETE" })).status,
        204,
      );
    }).pipe(Effect.scoped),
  );
});
