import { assert, describe, it } from "@effect/vitest";

import * as CloudMount from "../src/api/CloudMount.ts";
import * as PublicHost from "../src/PublicHost.ts";

describe("CloudMount", () => {
  it("strips the /cloud mount from routed requests", () => {
    assert.deepStrictEqual(CloudMount.resolve("/cloud/api/projects", ""), {
      _tag: "Application",
      path: "/api/projects",
      mounted: true,
    });
    assert.deepStrictEqual(CloudMount.resolve("/cloud/rpc", ""), {
      _tag: "Application",
      path: "/rpc",
      mounted: true,
    });
    assert.deepStrictEqual(CloudMount.resolve("/cloud/teams/team-1", ""), {
      _tag: "Assets",
      path: "/teams/team-1",
      mounted: true,
    });
    assert.deepStrictEqual(CloudMount.resolve("/cloud/assets/index.js", ""), {
      _tag: "Assets",
      path: "/assets/index.js",
      mounted: true,
    });
  });

  it("adds the trailing slash the web app is mounted at", () => {
    assert.deepStrictEqual(CloudMount.resolve("/cloud", "?a=1"), {
      _tag: "Redirect",
      location: "/cloud/?a=1",
    });
  });

  it("maps root well-known documents for the /cloud issuer and resource", () => {
    assert.deepStrictEqual(
      CloudMount.resolve("/.well-known/oauth-authorization-server/cloud", ""),
      { _tag: "Application", path: "/.well-known/oauth-authorization-server", mounted: true },
    );
    assert.deepStrictEqual(
      CloudMount.resolve("/.well-known/oauth-protected-resource/cloud/api/mcp", ""),
      {
        _tag: "Application",
        path: "/.well-known/oauth-protected-resource/api/mcp",
        mounted: true,
      },
    );
  });

  it("serves unmounted paths when reached directly", () => {
    assert.deepStrictEqual(CloudMount.resolve("/api/mcp", ""), {
      _tag: "Application",
      path: "/api/mcp",
      mounted: false,
    });
  });

  it("forwards exactly the paths its routes claim", () => {
    for (const path of [
      "/cloud",
      "/cloud/",
      "/cloud/api/projects",
      "/.well-known/oauth-authorization-server/cloud",
      "/.well-known/oauth-protected-resource/cloud/api/mcp",
    ])
      assert.isTrue(CloudMount.claims(path), path);
    for (const path of [
      "/",
      "/cloudy",
      "/api/website/session",
      "/.well-known/oauth-authorization-server",
    ])
      assert.isFalse(CloudMount.claims(path), path);
  });

  it("claims only Cloud's paths on the shared hostname", () => {
    assert.deepStrictEqual(CloudMount.routePatterns("macrograph.app"), [
      "macrograph.app/cloud",
      "macrograph.app/cloud/*",
      "macrograph.app/.well-known/oauth-authorization-server/cloud",
      "macrograph.app/.well-known/oauth-protected-resource/cloud/*",
    ]);
  });
});

describe("PublicHost", () => {
  it("gives only production a dedicated hostname", () => {
    assert.strictEqual(PublicHost.forStage("production"), "macrograph.app");
    assert.isUndefined(PublicHost.forStage("pr123"));
    assert.isUndefined(PublicHost.forStage("brendan"));
  });
});
