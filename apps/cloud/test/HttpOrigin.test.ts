import { assert, describe, it } from "@effect/vitest";

import { hasTrustedOrigin, requestOrigin } from "../src/api/HttpOrigin.ts";

describe("requestOrigin", () => {
  it("prefers the public host over an absolute internal URL", () => {
    assert.strictEqual(
      requestOrigin({
        url: "http://127.0.0.1:55813/api/projects/project-1/deploy",
        headers: {
          host: "macrograph.example.com",
          "x-forwarded-proto": "https",
        },
      }),
      "https://macrograph.example.com",
    );
  });

  it("uses a forwarded host when the direct host is internal", () => {
    assert.strictEqual(
      requestOrigin({
        url: "http://127.0.0.1:55813/api/projects/project-1/deploy",
        headers: {
          host: "127.0.0.1:55813",
          "x-forwarded-host": "macrograph.example.com",
          "x-forwarded-proto": "https",
        },
      }),
      "https://macrograph.example.com",
    );
  });
});

describe("hasTrustedOrigin", () => {
  it("accepts requests without an origin or with the same public origin", () => {
    assert.isTrue(
      hasTrustedOrigin({ url: "https://macrograph.example.com/api/projects", headers: {} }),
    );
    assert.isTrue(
      hasTrustedOrigin({
        url: "http://127.0.0.1:55813/api/projects",
        headers: {
          host: "macrograph.example.com",
          origin: "https://macrograph.example.com",
        },
      }),
    );
  });

  it("accepts local development origins and rejects invalid or cross-origin requests", () => {
    assert.isTrue(
      hasTrustedOrigin({
        url: "http://localhost:1337/api/projects",
        headers: { host: "localhost:1337", origin: "http://127.0.0.1:5173" },
      }),
    );
    assert.isFalse(
      hasTrustedOrigin({
        url: "https://macrograph.example.com/api/projects",
        headers: { host: "macrograph.example.com", origin: "not a URL" },
      }),
    );
    assert.isFalse(
      hasTrustedOrigin({
        url: "https://macrograph.example.com/api/projects",
        headers: { host: "macrograph.example.com", origin: "https://attacker.example.com" },
      }),
    );
  });
});
