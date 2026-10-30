import { assert, describe, it } from "@effect/vitest";
import { Package, PackageId, ResourceConstant, SchemaId } from "@macrograph/core";
import { Effect } from "effect";

import { ApiCaller, ApiKey, ProjectEditor } from "../src/index.ts";

describe("API keys", () => {
  it.effect("generates mg_ keys whose stored hash matches", () =>
    Effect.gen(function* () {
      const { key, keyHash } = yield* ApiKey.generate;
      assert.match(key, /^mg_[0-9a-f]{64}$/);
      assert.strictEqual(yield* ApiKey.hash(key), keyHash);
      assert.notStrictEqual(keyHash, key);
      assert.strictEqual(ApiKey.fromAuthorization(`Bearer ${key}`), key);
      assert.strictEqual(ApiKey.fromAuthorization(`bearer ${key}`), key);
      assert.isUndefined(ApiKey.fromAuthorization(`Basic ${key}`));
      assert.isUndefined(ApiKey.fromAuthorization(undefined));
    }),
  );
});

describe("API callers", () => {
  const rest = ApiCaller.forApiKey({ id: "key-1", name: "CI key" }, "ada.l@example.com");

  it("identifies REST callers by their API key", () => {
    assert.deepStrictEqual(ApiCaller.actorFor(rest, "user-1"), {
      type: "CLIENT",
      kind: "api",
      id: "api:key-1",
      userId: "user-1",
    });
    assert.deepStrictEqual(
      ApiCaller.identityFor(rest, {
        userId: "user-1",
        projectId: "local",
        canEdit: true,
        canManageCredentials: false,
      }),
      {
        actor: { type: "CLIENT", kind: "api", id: "api:key-1", userId: "user-1" },
        displayName: "ada.l",
        email: "ada.l@example.com",
        projectId: "local",
        canEdit: true,
        canManageCredentials: false,
        remote: {
          apiKeyId: "key-1",
          apiKeyName: "CI key",
          mcpSessionId: null,
          mcpClientName: null,
          mcpClientVersion: null,
        },
      },
    );
  });

  it("identifies MCP callers by their session, falling back to the key", () => {
    const client = { name: "Claude Desktop", version: "1.0" };
    const session = ApiCaller.forMcp(rest, "session-1", client);
    assert.strictEqual(ApiCaller.actorFor(session, "user-1").id, "mcp:session-1");
    assert.deepStrictEqual(ApiCaller.remoteClient(session), {
      apiKeyId: "key-1",
      apiKeyName: "CI key",
      mcpSessionId: "session-1",
      mcpClientName: "Claude Desktop",
      mcpClientVersion: "1.0",
    });
    const sessionless = ApiCaller.forMcp(rest, null, null);
    assert.strictEqual(ApiCaller.actorFor(sessionless, "user-1").id, "mcp:key-1");
    assert.strictEqual(ApiCaller.actorFor(ApiCaller.anonymous, "user-1").id, "api:user:user-1");
  });
});

describe("schema search", () => {
  const schema = (id: string, name: string, properties: Package.SchemaModel["properties"] = []) =>
    ({
      id: SchemaId.make(id),
      name,
      type: "exec",
      properties,
      dataInputs: [],
      dataOutputs: [],
      executionInputs: [],
      executionOutputs: [],
    }) satisfies Package.SchemaModel;
  const packages: Array<Package.Model> = [
    {
      id: PackageId.make("twitch"),
      name: "Twitch",
      resources: [{ id: "account", name: "Account" }],
      schemas: [
        schema("send-message", "Send Chat Message", [
          { id: "account", name: "Account", resource: "account", optional: false },
        ]),
        schema("ban", "Ban User"),
      ],
    },
    {
      id: PackageId.make("logic"),
      name: "Logic",
      resources: [],
      schemas: [schema("message-branch", "Branch On Message")],
    },
  ];
  const resources: Array<ResourceConstant.Model> = [
    {
      id: ResourceConstant.Id.make("bot"),
      name: "Bot",
      resource: { package: "twitch", resource: "account" },
    },
  ];

  it("ranks exact and prefix matches first and attaches matching resources", () => {
    const { schemas } = ProjectEditor.searchSchemas(packages, resources, {
      queries: ["send-message", "message"],
    });
    assert.deepStrictEqual(
      schemas.map((match) => match.schema.id),
      ["send-message", "message-branch"],
    );
    assert.deepStrictEqual(schemas[0]?.resources, {
      account: [{ id: resources[0]!.id, name: "Bot" }],
    });
    assert.lengthOf(ProjectEditor.searchSchemas(packages, resources, { limit: 1 }).schemas, 1);
    assert.lengthOf(ProjectEditor.searchSchemas(packages, resources, {}).schemas, 3);
  });
});
