import type { PGlite } from "@electric-sql/pglite";

import { assert, describe, it } from "@effect/vitest";
import { ApiCaller } from "@macrograph/project-api";
import { ConfigProvider, Effect, Fiber, Layer } from "effect";
import { HttpClient, type HttpClientRequest, HttpClientResponse, HttpRouter } from "effect/http";

import * as OAuthProviders from "../src/auth/OAuthProviders.ts";
import { Gateway } from "../src/gateway/Gateway.ts";
import { GatewayMcp } from "../src/gateway/GatewayMcp.ts";
import { GatewayRoutes } from "../src/website/GatewayRoutes.ts";
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
    const routes: App = yield* Layer.mergeAll(
      GatewayRoutes.layer,
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
      send(routes, `/api/website/gateway${path}`, {
        ...init,
        headers: { "content-type": "application/json", ...session, ...init?.headers },
      });
    const toolNames = rpc("tools/list").pipe(
      Effect.map((result) =>
        (result.tools as ReadonlyArray<{ readonly name: string }>).map((tool) => tool.name),
      ),
    );
    return { pg, requests, call, website, toolNames };
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

describe("Gateway", () => {
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
        403,
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
});
