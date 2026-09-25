import { assert, describe, it } from "@effect/vitest";
import { HttpEndpoint, HttpIngress } from "@macrograph/module";
import { Effect, Layer, Option, Redacted } from "effect";
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/unstable/http";

import { AppCredentials } from "../src/AppApi.ts";
import { AccountId, InstallationId, RepositoryId, WebhookId } from "../src/Definition.ts";
import deployment from "../src/Deployment/Webhook.ts";
import { handler as webhookHandler } from "../src/Webhook.ts";

const secret = "github-webhook-secret";
const endpoint = {
  id: HttpEndpoint.Id.make("endpoint-1"),
  url: "https://example.com/ingress/project/endpoint-1",
  schema: {
    id: HttpEndpoint.HandlerId.make("github:repository"),
    displayName: "Repository Webhook",
  },
  instanceKey: HttpEndpoint.InstanceKey.make("primary"),
  metadata: {
    webhookId: WebhookId.make("primary"),
    installationId: InstallationId.make("10"),
    repositoryId: RepositoryId.make("20"),
    owner: "macrograph",
    repository: "macrograph",
  },
};
const hostService: HttpEndpoint.Service = {
  ensure: (_handler, options) => Effect.succeed({ ...endpoint, metadata: options.metadata }),
  get: () => Effect.succeed(Option.none()),
  remove: () => Effect.void,
  lookup: () => Effect.succeed(Option.none()),
  secret: () => Effect.succeed(Redacted.make(secret)),
};
const host = Layer.succeed(HttpEndpoint.Host, hostService);
const dependencies = Layer.mergeAll(
  host,
  FetchHttpClient.layer,
  Layer.succeed(AppCredentials)({
    appId: "test-app",
    privateKey: Redacted.make("unused-private-key"),
  }),
);
const sign = async (body: Uint8Array) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, Uint8Array.from(body));
  return `sha256=${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
};
const readDerValue = (bytes: Uint8Array, offset: number) => {
  const firstLength = bytes[offset + 1] ?? 0;
  const lengthBytes = firstLength & 0x7f;
  let length = firstLength;
  let start = offset + 2;
  if ((firstLength & 0x80) !== 0) {
    length = 0;
    for (let index = 0; index < lengthBytes; index++)
      length = (length << 8) | (bytes[start + index] ?? 0);
    start += lengthBytes;
  }
  return { start, end: start + length };
};
const testPrivateKey = async () => {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
  const outer = readDerValue(pkcs8, 0);
  const version = readDerValue(pkcs8, outer.start);
  const algorithm = readDerValue(pkcs8, version.end);
  const privateKey = readDerValue(pkcs8, algorithm.end);
  const bytes = pkcs8.slice(privateKey.start, privateKey.end);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `-----BEGIN RSA PRIVATE KEY-----\n${btoa(binary)}\n-----END RSA PRIVATE KEY-----`;
};
const request = async (
  event = "push",
  signature?: string,
  payload: unknown = {
    ref: "refs/heads/main",
    installation: { id: 10 },
    repository: { id: 20, full_name: "macrograph/macrograph" },
    sender: { login: "octocat" },
  },
) => {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  return {
    endpoint,
    configuration: { events: ["push" as const] },
    method: "POST",
    headers: {
      "x-github-delivery": "delivery-1",
      "x-github-event": event,
      "x-github-hook-installation-target-id": "20",
      "x-github-hook-installation-target-type": "repository",
      "x-hub-signature-256": signature ?? (await sign(body)),
    },
    body,
  };
};

describe("GitHub repository webhook", () => {
  it.effect("derives an ingress requirement from storage", () =>
    Effect.gen(function* () {
      const requirements = yield* deployment.httpIngress.requirements({
        webhooks: {
          [WebhookId.make("primary")]: {
            name: "Main repository",
            accountId: AccountId.make("account-1"),
            installationId: InstallationId.make("10"),
            repositoryId: RepositoryId.make("20"),
            owner: "macrograph",
            repository: "macrograph",
            events: ["push", "pull_request"],
          },
        },
      });
      assert.deepStrictEqual(yield* HttpIngress.manifest(requirements), [
        {
          handlerId: HttpEndpoint.HandlerId.make("github:repository"),
          moduleId: "github",
          instanceKey: HttpEndpoint.InstanceKey.make("primary"),
          displayName: "Main repository",
          metadata: {
            webhookId: "primary",
            installationId: "10",
            repositoryId: "20",
            owner: "macrograph",
            repository: "macrograph",
          },
          configuration: { events: ["push", "pull_request"] },
        },
      ]);
    }),
  );

  it.effect("verifies signatures and emits normalized deliveries", () =>
    Effect.gen(function* () {
      const live = yield* webhookHandler.build.pipe(Effect.provide(dependencies));
      const response = yield* live.handle(yield* Effect.promise(() => request()));
      assert.strictEqual(response.status, 202);
      assert.strictEqual(response.events[0]?.eventId, "delivery-1");
      assert.deepInclude(response.events[0]?.payload, {
        webhookId: "primary",
        event: "push",
        sender: "octocat",
        owner: "macrograph",
        repository: "macrograph",
      });
    }),
  );

  it.effect("accepts repository-hook payloads without an installation object", () =>
    Effect.gen(function* () {
      const live = yield* webhookHandler.build.pipe(Effect.provide(dependencies));
      const response = yield* live.handle(
        yield* Effect.promise(() =>
          request("push", undefined, {
            ref: "refs/heads/main",
            repository: { id: 20, full_name: "macrograph/macrograph" },
            sender: { login: "octocat" },
          }),
        ),
      );
      assert.strictEqual(response.status, 202);
    }),
  );

  it.effect("rejects invalid signatures and accepts signed pings", () =>
    Effect.gen(function* () {
      const live = yield* webhookHandler.build.pipe(Effect.provide(dependencies));
      assert.strictEqual(
        (yield* live.handle(yield* Effect.promise(() => request("push", "sha256=bad")))).status,
        403,
      );
      assert.strictEqual(
        (yield* live.handle(yield* Effect.promise(() => request("ping")))).status,
        200,
      );
    }),
  );

  it.effect("rejects deliveries for a different installation or repository", () =>
    Effect.gen(function* () {
      const live = yield* webhookHandler.build.pipe(Effect.provide(dependencies));
      assert.strictEqual(
        (yield* live.handle(
          yield* Effect.promise(() =>
            request("push", undefined, {
              installation: { id: 11 },
              repository: { id: 20 },
            }),
          ),
        )).status,
        400,
      );
      assert.strictEqual(
        (yield* live.handle(
          yield* Effect.promise(() =>
            request("push", undefined, {
              installation: { id: 10 },
              repository: { id: 21 },
            }),
          ),
        )).status,
        400,
      );
      const wrongTarget = yield* Effect.promise(() => request());
      assert.strictEqual(
        (
          yield* live.handle({
            ...wrongTarget,
            headers: {
              ...wrongTarget.headers,
              "x-github-hook-installation-target-id": "21",
            },
          })
        ).status,
        400,
      );
    }),
  );

  it.effect("reconciles repository hooks on mount and removes them on unmount", () =>
    Effect.gen(function* () {
      const calls: Array<{ readonly method: string; readonly url: string }> = [];
      let hooks = [
        {
          id: 1,
          active: true,
          events: ["push"],
          config: { url: "https://old.example/ingress/project/endpoint-1" },
        },
        {
          id: 2,
          active: true,
          events: ["issues"],
          config: { url: "https://older.example/ingress/project/endpoint-1" },
        },
      ];
      const client = HttpClient.make((outgoing) =>
        Effect.sync(() => {
          calls.push({ method: outgoing.method, url: outgoing.url });
          const hookId = Number(outgoing.url.split("/").at(-1));
          if (outgoing.method === "DELETE") hooks = hooks.filter((hook) => hook.id !== hookId);
          if (outgoing.method === "PATCH" && outgoing.body._tag === "Uint8Array") {
            const body = JSON.parse(new TextDecoder().decode(outgoing.body.body));
            hooks = hooks.map((hook) =>
              hook.id === hookId
                ? {
                    ...hook,
                    active: true,
                    events: body.events,
                    config: { url: body.config.url },
                  }
                : hook,
            );
          }
          const body = outgoing.url.endsWith("/access_tokens")
            ? { token: "installation-token", expires_at: "2026-09-22T10:00:00Z" }
            : outgoing.method === "GET"
              ? hooks
              : null;
          return HttpClientResponse.fromWeb(
            outgoing,
            body === null
              ? new Response(null, { status: 204 })
              : new Response(JSON.stringify(body), {
                  status: 200,
                  headers: { "content-type": "application/json" },
                }),
          );
        }),
      );
      const mountedHost: HttpEndpoint.Service = {
        ...hostService,
        get: <Metadata>() =>
          Effect.succeed(
            Option.some({
              ...endpoint,
              metadata: endpoint.metadata as Metadata,
            }),
          ),
      };
      const lifecycleDependencies = Layer.mergeAll(
        Layer.succeed(HttpEndpoint.Host, mountedHost),
        Layer.succeed(HttpClient.HttpClient, client),
        Layer.succeed(AppCredentials)({
          appId: "123",
          privateKey: Redacted.make(yield* Effect.promise(testPrivateKey)),
        }),
      );
      const live = yield* webhookHandler.build.pipe(Effect.provide(lifecycleDependencies));
      const entry = {
        handlerId: HttpEndpoint.HandlerId.make("github:repository"),
        moduleId: "github",
        instanceKey: HttpEndpoint.InstanceKey.make("primary"),
        displayName: "Main repository",
        metadata: endpoint.metadata,
        configuration: { events: ["push", "pull_request"] },
      };

      yield* live.mount(entry, mountedHost);
      assert.deepStrictEqual(hooks, [
        {
          id: 1,
          active: true,
          events: ["push", "pull_request"],
          config: { url: endpoint.url },
        },
      ]);
      yield* live.unmount(entry, mountedHost);
      assert.deepStrictEqual(hooks, []);
      assert.deepStrictEqual(
        calls.map(({ method }) => method),
        ["POST", "GET", "DELETE", "PATCH", "POST", "GET", "DELETE"],
      );
    }),
  );
});
