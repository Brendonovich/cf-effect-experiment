import { it } from "@effect/vitest";
import { AppCredentials } from "@macrograph/module-github/AppApi";
import { Effect, Redacted } from "effect";
import { assert } from "vitest";

import { appCredentialsLayerFromEnvironment } from "../src/GitHubCredentials.ts";

it.effect("loads GitHub App credentials from the Worker environment", () =>
  Effect.gen(function* () {
    const credentials = yield* AppCredentials;
    assert.strictEqual(credentials.appId, "123");
    assert.strictEqual(Redacted.value(credentials.privateKey), "private-key");
  }).pipe(
    Effect.provide(
      appCredentialsLayerFromEnvironment({
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "private-key",
      }),
    ),
  ),
);
