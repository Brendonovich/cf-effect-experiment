import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

import * as Jwt from "../src/website/Jwt.ts";
import * as PreviewAuth from "../src/website/PreviewAuth.ts";
import { type App, harness, send, signIn } from "./OAuthHarness.ts";

const preview = "https://macrograph-websiteworker-pr42-abc123.brendonovich.workers.dev";

const start = (previewOrigin: string) =>
  `${PreviewAuth.startPath}?${new URLSearchParams({ origin: previewOrigin, next: "/account/apps?x=1" })}`;

/** A gate for `preview` that fetches production's JWKS from the test website. */
const makeGate = (app: App, allowed: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const cookieKey = yield* Jwt.hmacKey("preview-secret");
    const gate = PreviewAuth.makeGate({
      allowedUsers: new Set(allowed),
      cookieKey: Effect.succeed(cookieKey),
      fetch: (url) => Effect.runPromise(send(app, new URL(String(url)).pathname)),
    });
    return (url: string, init?: RequestInit) =>
      gate(HttpServerRequest.fromWeb(new Request(url, init)), new URL(url)).pipe(
        Effect.map((response) =>
          response === undefined ? undefined : HttpServerResponse.toWeb(response),
        ),
      );
  });

/** Signs `userId` in to production and follows `/auth/preview` to the preview callback. */
const grantFor = (userId: string, previewOrigin = preview) =>
  Effect.gen(function* () {
    const { app, pg } = yield* harness;
    const session = yield* signIn(pg, userId);
    const response = yield* send(app, start(previewOrigin), { headers: session });
    assert.strictEqual(response.status, 302);
    return { app, callback: new URL(response.headers.get("location") ?? "") };
  });

describe("preview auth", () => {
  it.effect("only sends grants to preview deployments", () =>
    Effect.gen(function* () {
      const { app, pg } = yield* harness;
      const session = yield* signIn(pg, "owner");
      for (const origin of [
        "https://attacker.example",
        "http://macrograph-websiteworker-pr42-abc123.brendonovich.workers.dev",
        "https://macrograph-websiteworker-pr42-abc123.brendonovich.workers.dev.attacker.example",
        "https://macrograph-cloudworker-pr42-abc123.brendonovich.workers.dev",
        `${preview}/path`,
      ]) {
        const response = yield* send(app, start(origin), { headers: session });
        assert.strictEqual(response.status, 400, origin);
      }
    }),
  );

  it.effect("asks signed-out visitors to log in and then continues", () =>
    Effect.gen(function* () {
      const { app } = yield* harness;
      const response = yield* send(app, start(preview));
      assert.strictEqual(response.status, 302);
      const login = new URL(response.headers.get("location") ?? "", "https://macrograph.app");
      assert.strictEqual(login.pathname, "/login");
      assert.strictEqual(login.searchParams.get("next"), start(preview));
    }),
  );

  it.effect("lets allowed accounts into the preview", () =>
    Effect.gen(function* () {
      const { app, callback } = yield* grantFor("owner");
      assert.strictEqual(callback.origin, preview);
      assert.strictEqual(callback.pathname, PreviewAuth.callbackPath);
      const gate = yield* makeGate(app, ["owner"]);

      const signedIn = yield* gate(callback.href);
      assert.strictEqual(signedIn?.status, 302);
      assert.strictEqual(signedIn?.headers.get("location"), "/account/apps?x=1");
      const cookie = signedIn?.headers.get("set-cookie")?.split(";")[0] ?? "";
      assert.isTrue(cookie.startsWith(`${PreviewAuth.cookieName}=`));
      assert.match(signedIn?.headers.get("set-cookie") ?? "", /HttpOnly/);

      assert.isUndefined(yield* gate(`${preview}/cloud/`, { headers: { cookie } }));
      assert.isUndefined(
        yield* gate(`${preview}/api/website/session`, { method: "POST", headers: { cookie } }),
      );
    }),
  );

  it.effect("sends visitors without a cookie to production", () =>
    Effect.gen(function* () {
      const { app } = yield* harness;
      const gate = yield* makeGate(app, ["owner"]);
      const page = yield* gate(`${preview}/account/credentials?tab=1`);
      assert.strictEqual(page?.status, 302);
      assert.strictEqual(
        page?.headers.get("location"),
        PreviewAuth.startUrl(preview, "/account/credentials?tab=1"),
      );
      const write = yield* gate(`${preview}/api/website/logout`, { method: "POST" });
      assert.strictEqual(write?.status, 401);
      const forged = yield* gate(`${preview}/`, {
        headers: { cookie: `${PreviewAuth.cookieName}=not-a-token` },
      });
      assert.strictEqual(forged?.status, 302);
    }),
  );

  it.effect("rejects accounts that aren't allowed", () =>
    Effect.gen(function* () {
      const { app, callback } = yield* grantFor("someone-else");
      const gate = yield* makeGate(app, ["owner"]);
      assert.strictEqual((yield* gate(callback.href))?.status, 403);
      const nobody = yield* makeGate(app, []);
      assert.strictEqual((yield* nobody(callback.href))?.status, 403);
    }),
  );

  it.effect("rejects grants for another preview or tampered with", () =>
    Effect.gen(function* () {
      const other = "https://macrograph-websiteworker-pr7-def456.brendonovich.workers.dev";
      const { app, callback } = yield* grantFor("owner", other);
      const gate = yield* makeGate(app, ["owner"]);
      const token = callback.searchParams.get("token") ?? "";
      const replayed = `${preview}${PreviewAuth.callbackPath}?token=${token}`;
      assert.strictEqual((yield* gate(replayed))?.status, 403);

      const valid = yield* grantFor("owner");
      const validGate = yield* makeGate(valid.app, ["owner"]);
      const tampered = new URL(valid.callback);
      tampered.searchParams.set("token", `${tampered.searchParams.get("token")?.slice(0, -4)}AAAA`);
      assert.strictEqual((yield* validGate(tampered.href))?.status, 403);
    }),
  );
});
