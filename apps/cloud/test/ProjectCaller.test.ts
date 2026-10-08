import { assert, describe, it } from "@effect/vitest";
import { CurrentUser } from "@macrograph/cloud-api";
import { Presence } from "@macrograph/editor";
import { ApiCaller } from "@macrograph/project-api";
import { Effect } from "effect";

import { ProjectCaller } from "../src/project/ProjectCaller.ts";

describe("project callers", () => {
  const key = ApiCaller.forApiKey({ id: "key-1", name: "Laptop" }, "ada.l@example.com");

  it.effect("passes MCP client details to the project editor in a cloneable identity", () =>
    Effect.gen(function* () {
      const identity = yield* ProjectCaller.identity("project-1", true).pipe(
        Effect.provideService(
          ApiCaller.Current,
          ApiCaller.forMcp(key, "session-1", { name: "Claude Desktop", version: "1.2.3" }),
        ),
      );
      assert.deepStrictEqual(identity, {
        actor: { type: "CLIENT", kind: "mcp", id: "mcp:session-1", userId: "user-1" },
        displayName: "ada.l",
        email: "ada.l@example.com",
        projectId: "project-1",
        canEdit: true,
        canManageCredentials: false,
        remote: {
          apiKeyId: "key-1",
          apiKeyName: "Laptop",
          mcpSessionId: "session-1",
          mcpClientName: "Claude Desktop",
          mcpClientVersion: "1.2.3",
        },
      });
      // Durable Object RPC arguments are structured-cloned.
      assert.deepStrictEqual(structuredClone(identity), identity);
      assert.deepStrictEqual(Presence.remoteLabel(structuredClone(identity)), {
        name: "Claude Desktop",
        version: "1.2.3",
        apiKeyName: "Laptop",
      });
    }).pipe(Effect.provideService(CurrentUser, { id: "user-1", sessionId: undefined })),
  );

  it.effect("names users without an email like their browser tabs", () =>
    Effect.gen(function* () {
      const identity = yield* ProjectCaller.identity("project-1", false).pipe(
        Effect.provideService(
          ApiCaller.Current,
          ApiCaller.forApiKey({ id: "key-2", name: "CI" }, null),
        ),
      );
      assert.strictEqual(identity.displayName, Presence.fallbackName("project-1\0user-1"));
      assert.isFalse(identity.canEdit);
      assert.deepStrictEqual(Presence.remoteLabel(identity), {
        name: "CI",
        version: null,
        apiKeyName: "CI",
      });
    }).pipe(Effect.provideService(CurrentUser, { id: "user-1", sessionId: undefined })),
  );
});
