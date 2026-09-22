import { assert, describe, it } from "vitest";

import { logoutWebsite } from "./websiteLogout";

describe("website logout", () => {
  it("sends a credentialed POST to the host that owns the website cookie", async () => {
    const calls: Array<{ input: Parameters<typeof fetch>[0]; init: RequestInit | undefined }> = [];
    const success = await logoutWebsite(async (input, init) => {
      calls.push({ input, init });
      return new Response(null, { status: 204 });
    });

    assert.isTrue(success);
    assert.lengthOf(calls, 1);
    assert.strictEqual(calls[0]?.input, "https://www.macrograph.app/api/cloud-logout");
    assert.strictEqual(calls[0]?.init?.method, "POST");
    assert.strictEqual(calls[0]?.init?.credentials, "include");
    assert.strictEqual(calls[0]?.init?.mode, "cors");
    assert.strictEqual(calls[0]?.init?.redirect, "error");
    assert.strictEqual(calls[0]?.init?.cache, "no-store");
    assert.deepEqual(calls[0]?.init?.headers, { "content-type": "application/json" });
    assert.instanceOf(calls[0]?.init?.signal, AbortSignal);
  });

  it("does not report success when cookie clearing could not be confirmed", async () => {
    for (const status of [200, 401, 403, 404, 500]) {
      assert.isFalse(await logoutWebsite(async () => new Response(null, { status })));
    }
    assert.isFalse(
      await logoutWebsite(async () => {
        throw new TypeError("Network error");
      }),
    );
  });
});
