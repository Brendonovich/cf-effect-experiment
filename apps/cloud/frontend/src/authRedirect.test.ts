import { assert, describe, it } from "vitest";

import { isWorkerRoute, signInReturnPath, signInUrl } from "./authRedirect";

describe("auth redirects", () => {
  it("sends sign-in to the website's login with the full Cloud path", () => {
    const destination = "/cloud/teams/team?tab=projects#recent";
    const url = new URL(signInUrl(destination), "https://macrograph.app");
    assert.strictEqual(url.pathname, "/login");
    assert.strictEqual(url.searchParams.get("next"), destination);
  });

  it("returns only to paths under Cloud's mount", () => {
    assert.strictEqual(
      signInReturnPath("/cloud/teams/team?tab=projects#recent", "/cloud/"),
      "/cloud/teams/team?tab=projects#recent",
    );
    assert.strictEqual(signInReturnPath(null, "/cloud/"), "/cloud/");
    assert.strictEqual(signInReturnPath("/cloud/sign-in", "/cloud/"), "/cloud/");
    assert.strictEqual(signInReturnPath("/elsewhere", "/cloud/"), "/cloud/");
    assert.strictEqual(signInReturnPath("/cloud-other", "/cloud/"), "/cloud/");
    assert.strictEqual(signInReturnPath("https://evil.example/cloud/", "/cloud/"), "/cloud/");
    assert.strictEqual(signInReturnPath("//evil.example/cloud/", "/cloud/"), "/cloud/");
  });

  it("treats OAuth endpoints under the mount as worker routes", () => {
    assert.isTrue(isWorkerRoute("/cloud/oauth/authorize?client_id=x", "/cloud/"));
    assert.isFalse(isWorkerRoute("/cloud/teams", "/cloud/"));
    assert.isFalse(isWorkerRoute("/oauth/authorize", "/cloud/"));
  });

  it("rejects external destinations and sign-in loops", () => {
    for (const next of [
      "https://attacker.example",
      "//attacker.example",
      "/\\attacker.example",
      "javascript:alert(1)",
      "settings",
      "/cloud/sign-in",
      "/cloud/sign-in/?next=/cloud/sign-in",
      "/CLOUD/SIGN-IN",
      "/cloud/%73ign-in",
      "/cloud/broken%",
    ])
      assert.strictEqual(signInReturnPath(next, "/cloud/"), "/cloud/", next);
  });
});
