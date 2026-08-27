import { assert, describe, it } from "@effect/vitest";
import * as Cloudflare from "alchemy/Cloudflare";
import { Cause, ConfigProvider, Effect, Exit } from "effect";
import { afterEach, vi } from "vitest";

import { projectIngressImplementation } from "../src/ingress/ProjectIngressDO.ts";

afterEach(() => vi.unstubAllGlobals());

describe("Project ingress preview", () => {
  it.effect("reports setup failures, retries unchanged settings, and cleans up partial subscriptions", () =>
    Effect.gen(function* () {
      const stored = new Map<string, unknown>();
      const rawStorage = {
        get: async (key: string) => stored.get(key),
        put: async (keyOrEntries: string | Record<string, unknown>, value?: unknown) => {
          const entries =
            typeof keyOrEntries === "string" ? { [keyOrEntries]: value } : keyOrEntries;
          for (const [key, value] of Object.entries(entries)) stored.set(key, value);
        },
        delete: async (keys: ReadonlyArray<string>) => {
          for (const key of keys) stored.delete(key);
        },
        transaction: async <A>(f: (storage: typeof rawStorage) => Promise<A>): Promise<A> =>
          f(rawStorage),
      };
      // Only the storage surface is used by preview reconciliation.
      const state = {
        raw: { storage: rawStorage },
        storage: {
          get: (key: string) => Effect.sync(() => stored.get(key)),
          put: (key: string, value: unknown) => Effect.sync(() => stored.set(key, value)),
          delete: (key: string) => Effect.sync(() => stored.delete(key)),
        },
      } as unknown as Cloudflare.DurableObjectState["Service"];
      let fail = true;
      let creates = 0;
      const subscriptions = new Map<string, unknown>();
      const deleted: Array<string> = [];
      vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        if (request.url === "https://id.twitch.tv/oauth2/token")
          return Response.json({ access_token: "app-token" });
        assert.strictEqual(new URL(request.url).pathname, "/helix/eventsub/subscriptions");
        if (request.method === "GET")
          return Response.json({
            data: [...subscriptions.values()], total: subscriptions.size,
            total_cost: 0, max_total_cost: 10_000,
          });
        if (request.method === "DELETE") {
          const id = new URL(request.url).searchParams.get("id")!;
          subscriptions.delete(id);
          deleted.push(id);
          return new Response(null, { status: 204 });
        }
        assert.strictEqual(request.method, "POST");
        creates++;
        const payload = await request.json() as { type: string };
        if (fail && payload.type === "channel.ban")
          return Response.json({ message: "subscription missing proper authorization" }, { status: 403 });
        subscriptions.set(payload.type, {
          ...payload, id: payload.type, status: "enabled",
          cost: 0, created_at: "2026-08-27T00:00:00Z",
        });
        return Response.json({ data: [{ id: payload.type }] }, { status: 202 });
      });
      yield* Effect.gen(function* () {
        const ingress = yield* Effect.flatten(projectIngressImplementation);
        const request = {
          projectId: "project-1",
          publicOrigin: "https://example.com",
          previewId: "editor",
          engines: {
            twitch: {
              accounts: { "account-1": { enabled: true, subscriptions: ["channel.ban"] } },
            },
          },
        };

        const failed = yield* Effect.exit(ingress.preview(request));
        assert.isTrue(Exit.isFailure(failed));
        if (Exit.isFailure(failed)) {
          const message = String(Cause.squash(failed.cause));
          assert.include(message, "channel.ban");
          assert.include(message, "subscription missing proper authorization");
        }
        assert.propertyVal(stored.get("preview-deployment"), "reconciliationPending", true);
        assert.deepStrictEqual((yield* ingress.ingressState()).preview?.endpoints, []);

        fail = false;
        const result = yield* ingress.preview(request);
        assert.strictEqual(result.endpoints.length, 1);
        assert.strictEqual(creates, 2);

        // A normal unchanged reconciliation can reuse the successful mount.
        yield* ingress.preview(request);
        assert.strictEqual(creates, 2);

        // Connect must retry provider setup, not just trust an allocated endpoint.
        subscriptions.clear();
        fail = true;
        assert.isTrue(
          Exit.isFailure(yield* Effect.exit(ingress.preview({ ...request, remount: true }))),
        );
        assert.strictEqual(creates, 3);
        assert.propertyVal(stored.get("preview-deployment"), "reconciliationPending", true);
        assert.deepStrictEqual((yield* ingress.ingressState()).preview?.endpoints, result.endpoints);

        fail = false;
        const retried = yield* ingress.preview({ ...request, remount: true });
        assert.strictEqual(creates, 4);
        assert.deepStrictEqual(retried.endpoints, result.endpoints);

        fail = true;
        const partialRequest = {
          ...request,
          engines: {
            twitch: {
              accounts: {
                "account-2": { enabled: true, subscriptions: ["channel.unban", "channel.ban"] },
              },
            },
          },
        };
        assert.isTrue(Exit.isFailure(yield* Effect.exit(ingress.preview(partialRequest))));
        assert.deepStrictEqual([...subscriptions.keys()], ["channel.ban", "channel.unban"]);
        yield* ingress.preview({ ...request, engines: { twitch: { accounts: {} } } });
        assert.deepStrictEqual(deleted, ["channel.ban", "channel.unban"]);
        assert.strictEqual(subscriptions.size, 0);
      }).pipe(
        Effect.provideService(Cloudflare.DurableObjectState, state),
        Effect.provideService(Cloudflare.WorkerEnvironment, {}),
        Effect.provide(
          ConfigProvider.layer(ConfigProvider.fromUnknown({
            TWITCH_CLIENT_ID: "test-client-id",
            TWITCH_CLIENT_SECRET: "test-client-secret",
          })),
        ),
      );
    }),
  );
});
