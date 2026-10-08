import { assert, describe, it } from "vitest";

import { isWorkerRoute, signInReturnPath, signInUrl } from "./authRedirect";

describe("sign-in redirects", () => {
  it("preserves the complete destination through the sign-in URL", () => {
    const destination = "/teams/team/projects/project/settings?tab=credentials#twitch";
    const url = new URL(signInUrl(destination), "https://cloud.macrograph.app");
    assert.strictEqual(url.pathname, "/sign-in");
    assert.strictEqual(signInReturnPath(url.searchParams.get("next")), destination);
  });

  it("defaults to the workspace root", () => {
    assert.strictEqual(signInReturnPath(null), "/");
    assert.strictEqual(signInReturnPath("/"), "/");
  });

  it("keeps redirects within a configured application base path", () => {
    const destination = "/cloud/teams/team?tab=projects#recent";
    const url = new URL(signInUrl(destination, "/cloud/"), "https://cloud.macrograph.app");
    assert.strictEqual(url.pathname, "/cloud/sign-in");
    assert.strictEqual(signInReturnPath(url.searchParams.get("next"), "/cloud/"), destination);
    assert.strictEqual(signInReturnPath(null, "/cloud/"), "/cloud/");
    assert.strictEqual(signInReturnPath("/cloud/sign-in", "/cloud/"), "/cloud/");
    assert.strictEqual(signInReturnPath("/elsewhere", "/cloud/"), "/cloud/");
    assert.strictEqual(signInReturnPath("/cloud-other", "/cloud/"), "/cloud/");
  });

  it("returns to worker-served OAuth authorization requests", () => {
    const destination =
      "/oauth/authorize?response_type=code&client_id=client&redirect_uri=http%3A%2F%2F127.0.0.1%3A65273%2Fcallback";
    const url = new URL(signInUrl(destination), "https://cloud.macrograph.app");
    const returnPath = signInReturnPath(url.searchParams.get("next"));
    assert.strictEqual(returnPath, destination);
    assert.isTrue(isWorkerRoute(returnPath));
    assert.isFalse(isWorkerRoute("/teams/team"));
    assert.isFalse(isWorkerRoute("/oauthish"));
  });

  it("rejects external destinations and sign-in loops", () => {
    for (const next of [
      "https://attacker.example",
      "//attacker.example",
      "/\\attacker.example",
      "javascript:alert(1)",
      "settings",
      "/sign-in",
      "/sign-in/?next=/sign-in",
      "/SIGN-IN",
      "/%73ign-in",
      "/broken%",
    ])
      assert.strictEqual(signInReturnPath(next), "/", next);
  });
});
