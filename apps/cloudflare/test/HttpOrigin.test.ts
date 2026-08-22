import { assert, describe, it } from "@effect/vitest";

import { requestOrigin } from "../src/HttpOrigin.ts";

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
