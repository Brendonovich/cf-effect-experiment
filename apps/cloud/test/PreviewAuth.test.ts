import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  isPreviewOrigin,
  parsePreviewRedirectUri,
  pkceChallenge,
} from "../src/auth/PreviewAuth.ts";

describe("preview authorization validation", () => {
  it("only accepts HTTPS worker hosts in the configured Cloudflare account", () => {
    assert.isTrue(
      isPreviewOrigin(
        "https://macrograph-cloudworker-pr123-abcdefghijklmnop.brendonovich.workers.dev",
      ),
    );
    assert.isFalse(isPreviewOrigin("https://brendonovich.workers.dev"));
    assert.isFalse(isPreviewOrigin("https://preview.attacker.workers.dev"));
    assert.isFalse(
      isPreviewOrigin(
        "http://macrograph-cloudworker-pr123-abcdefghijklmnop.brendonovich.workers.dev",
      ),
    );
    assert.isFalse(
      isPreviewOrigin(
        "https://macrograph-cloudworker-pr123-abcdefghijklmnop.brendonovich.workers.dev.attacker.example",
      ),
    );
  });

  it("accepts only the exact callback URL on the configured account", () => {
    assert.strictEqual(
      parsePreviewRedirectUri(
        "https://macrograph-cloudworker-pr123-abcdefghijklmnop.brendonovich.workers.dev/preview-auth/callback",
      )?.pathname,
      "/preview-auth/callback",
    );
    assert.isUndefined(
      parsePreviewRedirectUri(
        "https://macrograph-cloudworker-pr123-abcdefghijklmnop.brendonovich.workers.dev/preview-auth/callback?return=%2F",
      ),
    );
    assert.isUndefined(
      parsePreviewRedirectUri(
        "https://user@macrograph-cloudworker-pr123-abcdefghijklmnop.brendonovich.workers.dev/callback",
      ),
    );
    assert.isUndefined(
      parsePreviewRedirectUri(
        "https://macrograph-cloudworker-pr123-abcdefghijklmnop.brendonovich.workers.dev:444/callback",
      ),
    );
    assert.isUndefined(parsePreviewRedirectUri("https://preview.attacker.workers.dev/callback"));
  });

  it.effect("computes the RFC 7636 S256 challenge", () =>
    Effect.gen(function* () {
      assert.strictEqual(
        yield* pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      );
    }),
  );
});
