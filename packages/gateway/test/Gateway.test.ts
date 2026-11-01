import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/http";

import { Catalog, Execute, defaultPolicy, snakeCase } from "../src/index.ts";

const account = { id: "1234", displayName: "brendonovich" };

const tool = (name: string) => {
  const found = Catalog.tool(name);
  if (found === undefined) throw new Error(`Missing tool ${name}`);
  return found;
};

const recording = (respond: (request: HttpClientRequest.HttpClientRequest) => Response) => {
  const requests: Array<HttpClientRequest.HttpClientRequest> = [];
  const layer = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        requests.push(request);
        return HttpClientResponse.fromWeb(request, respond(request));
      }),
    ),
  );
  return { requests, layer };
};

describe("Catalog", () => {
  it("names every tool uniquely with an MCP-safe, provider-prefixed name", () => {
    const names = Catalog.tools.map((tool) => tool.name);
    assert.strictEqual(new Set(names).size, names.length);
    for (const tool of Catalog.tools) {
      assert.match(tool.name, /^[a-z0-9_]{1,64}$/);
      assert.isTrue(tool.name.startsWith(`${tool.provider}_`));
      assert.isDefined(Catalog.provider(tool.provider));
    }
  });

  it("converts identifiers to snake case", () => {
    assert.strictEqual(snakeCase("WarnUser"), "warn_user");
    assert.strictEqual(snakeCase("AddVIP"), "add_vip");
    assert.strictEqual(snakeCase("GetUserChatColorByID"), "get_user_chat_color_by_id");
    assert.strictEqual(snakeCase("list-pull-requests"), "list_pull_requests");
  });

  it("allows reads and asks before writes by default", () => {
    assert.strictEqual(defaultPolicy(tool("twitch_get_chatters")), "allow");
    assert.strictEqual(defaultPolicy(tool("twitch_ban_user")), "approve");
    assert.strictEqual(defaultPolicy(tool("github_list_issues")), "allow");
    assert.strictEqual(defaultPolicy(tool("github_create_issue")), "approve");
  });

  it("describes inputs as a JSON schema, with the channel defaulting to the account", () => {
    const schema = tool("twitch_ban_user").inputSchema;
    assert.containsAllKeys(schema.properties, ["broadcasterId", "userId", "duration", "reason"]);
    assert.notInclude(schema.required, "broadcasterId");
    assert.include(schema.required, "userId");
    assert.deepInclude(schema.properties.duration, { type: "integer", minimum: 1 });
  });
});

describe("Twitch tools", () => {
  it.effect("acts as the connected account", () =>
    Effect.gen(function* () {
      const request = yield* tool("twitch_ban_user").prepare(
        { userId: "99", reason: "spam" },
        account,
      );
      assert.deepStrictEqual(request, {
        method: "POST",
        path: "/moderation/bans",
        query: { broadcaster_id: "1234", moderator_id: "1234" },
        body: { data: { user_id: "99", reason: "spam" } },
      });
    }),
  );

  it.effect("rejects invalid inputs", () =>
    Effect.gen(function* () {
      const error = yield* tool("twitch_ban_user").prepare({}, account).pipe(Effect.flip);
      assert.strictEqual(error._tag, "GatewayInvalidInput");
      assert.include(error.message, "userId");
    }),
  );
});

describe("GitHub tools", () => {
  it.effect("defaults list filters", () =>
    Effect.gen(function* () {
      const request = yield* tool("github_list_issues").prepare(
        { owner: "macrograph", repository: "macrograph" },
        account,
      );
      assert.deepStrictEqual(request.query, { state: "open", per_page: 30 });
      assert.strictEqual(request.path, "/repos/macrograph/macrograph/issues");
    }),
  );

  it.effect("rejects missing inputs without throwing", () =>
    Effect.gen(function* () {
      const error = yield* tool("github_get_issue")
        .prepare({ owner: "a", repository: "b" }, account)
        .pipe(Effect.flip);
      assert.include(error.message, "number");
    }),
  );
});

describe("Execute", () => {
  it.effect("adds the account's authorization and decodes JSON", () => {
    const { requests, layer } = recording(() => Response.json({ data: [] }));
    return Effect.gen(function* () {
      const twitch = Catalog.provider("twitch");
      assert.isDefined(twitch);
      if (twitch === undefined) return;
      const response = yield* Execute.execute(
        twitch,
        { method: "GET", path: "/chat/chatters", query: { broadcaster_id: "1" } },
        { accessToken: "secret", clientId: "client" },
      );
      assert.deepStrictEqual(response, { status: 200, body: { data: [] } });
      assert.strictEqual(requests[0]?.url, "https://api.twitch.tv/helix/chat/chatters");
      assert.strictEqual(requests[0]?.urlParams.params[0]?.[1], "1");
      assert.strictEqual(requests[0]?.headers.authorization, "Bearer secret");
      assert.strictEqual(requests[0]?.headers["client-id"], "client");
    }).pipe(Effect.provide(layer));
  });

  it.effect("refuses URLs outside the provider's origins", () => {
    const { requests, layer } = recording(() => Response.json({}));
    return Effect.gen(function* () {
      const github = Catalog.provider("github");
      if (github === undefined) return assert.fail("missing provider");
      const error = yield* Execute.execute(
        github,
        { method: "GET", path: "https://evil.example/steal" },
        { accessToken: "secret", clientId: undefined },
      ).pipe(Effect.flip);
      assert.strictEqual(error._tag, "GatewayRequestError");
      assert.lengthOf(requests, 0);
    }).pipe(Effect.provide(layer));
  });

  it("allows the provider's extra origins", () => {
    const twitch = Catalog.provider("twitch");
    if (twitch === undefined) return assert.fail("missing provider");
    assert.strictEqual(
      Execute.url(twitch, { method: "GET", path: "https://id.twitch.tv/oauth2/validate" })?.href,
      "https://id.twitch.tv/oauth2/validate",
    );
  });
});
